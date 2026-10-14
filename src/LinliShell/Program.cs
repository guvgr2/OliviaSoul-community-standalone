// 「林离的信」外壳。
//
// 职责只有三件：自检 → 拉起内置 Node 跑本机服务 → 用 Edge 的应用窗口打开界面 → 退出时把 Node 收干净。
// 不做业务逻辑，不碰信件内容。
//
// 为什么用 Edge 应用窗口（--app=）：界面要靠 backdrop-filter 做玻璃质感，
// 只有浏览器引擎能渲染；Edge 每台 Windows 都有，不必再打包一个几十 MB 的内核。
// 没有 Edge 时退回默认浏览器，功能一样，只是没有独立窗口。
//
// ★ 开机自启动（安装程序写的 Run 项带了 --startup）：只进托盘、不弹窗口。
//   自己双击打开才是"要用它"，开机被拉起来只是"让它待命" —— 不该一开机就糊一个窗口到脸上。
//
// ★ 自检：启动动画在放的那几秒不是干等，是在挨个查"能不能真的用起来"。
//   查不过就别进界面 —— 进去了也是一片空白，那比报错更让人懵。
//   每一条失败都有一个**固定代号 + 一句人话 + 一个能自己动手修的办法**（对位竞品
//   Install.ps1 的 Get-SafeSetupErrorCode：用户把代号报过来就能对上号，不用猜是哪一步）。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace LinliLetters;

internal static class Program
{
    // ★ 安装程序用这个互斥量认出"林离正在跑"，装之前先请它退出（install.iss 的 AppMutex）。
    private const string AppMutexName = "LinliLetters.App";

    private static NotifyIcon _tray;
    private static Process _node;
    private static string _url;
    private static Mutex _single;

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool startup = Array.Exists(args ?? Array.Empty<string>(),
            a => string.Equals(a, "--startup", StringComparison.OrdinalIgnoreCase));

        // 只允许一个实例。第二个实例把已经开着的那一个叫醒就够了。
        _single = new Mutex(true, AppMutexName, out bool owned);
        if (!owned)
        {
            _single.Dispose();
            _single = null;
            if (!startup) Native.BringExistingToFront();
            return;                       // 已经在跑了 —— 静默退出，不弹"已在运行"的框
        }

        string appDir = ResolveAppDir();
        string nodeExe = Path.Combine(appDir, "runtime", "node", "node.exe");
        string server = Path.Combine(appDir, "app", "server.mjs");

        Check check = Preflight.Run(appDir, nodeExe, server);
        if (!check.Ok)
        {
            Report(check, null);
            _single?.ReleaseMutex();
            return;
        }

        if (!StartNode(nodeExe, server, appDir, out int port, out Check nodeErr))
        {
            Report(nodeErr, null);
            _single?.ReleaseMutex();
            return;
        }

        _url = $"http://127.0.0.1:{port}/";

        // ★ 服务起来了 ≠ 能用。再探一次 /health，确认它真的在应答。
        Check health = WaitForHealth(port, TimeSpan.FromSeconds(15));
        if (!health.Ok)
        {
            Report(health, _url);
            KillNode();
            _single?.ReleaseMutex();
            return;
        }

        BuildTray(appDir);
        if (!startup) OpenWindow();       // --startup ⇒ 只进托盘
        Application.Run();

        _single?.ReleaseMutex();
    }

    // ---------------------------------------------------------------- 自检

    private static Check WaitForHealth(int port, TimeSpan limit)
    {
        var sw = Stopwatch.StartNew();
        Exception last = null;
        while (sw.Elapsed < limit)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create($"http://127.0.0.1:{port}/health");
                req.Timeout = 2000;
                req.ServicePoint.Expect100Continue = false;
                using var resp = (HttpWebResponse)req.GetResponse();
                if ((int)resp.StatusCode >= 200 && (int)resp.StatusCode < 300)
                    return Check.Pass();
            }
            catch (Exception ex)
            {
                last = ex;
                Thread.Sleep(400);
            }
        }
        return Check.Fail("E-HEALTH-NO-ANSWER",
            "服务起来了，但它一直没回应。",
            "通常是端口被安全软件拦了，或者上一次的林离没退干净。\n" +
            "试试：退出托盘里的林离再打开一次；还不行就把安全软件里 127.0.0.1 的本机连接放行。",
            last?.Message);
    }

    private static void Report(Check c, string url)
    {
        var text = new StringBuilder();
        text.AppendLine(c.Title);
        text.AppendLine();
        text.AppendLine(c.Detail);
        if (!string.IsNullOrWhiteSpace(c.Fix))
        {
            text.AppendLine();
            text.AppendLine("可以这样做：");
            text.AppendLine(c.Fix);
        }
        if (!string.IsNullOrWhiteSpace(c.Technical))
        {
            text.AppendLine();
            text.AppendLine("（给排查用的原始信息：" + c.Technical + "）");
        }
        if (!string.IsNullOrEmpty(url))
        {
            text.AppendLine();
            text.AppendLine("服务地址是 " + url + "，也可以自己用浏览器打开看看。");
        }
        text.AppendLine();
        text.Append("错误代号：" + c.Code);

        MessageBox.Show(text.ToString(), "林离的信 · 没能起来",
            MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    // ---------------------------------------------------------------- 起 Node

    private static string ResolveAppDir()
    {
        // 发布形态：LinliLetters.exe 在 <root>\ 下，app\ 与 runtime\ 与它同级。
        string exeDir = AppContext.BaseDirectory;
        for (int i = 0; i < 4; i++)
        {
            string candidate = exeDir;
            if (File.Exists(Path.Combine(candidate, "app", "server.mjs"))) return candidate;
            DirectoryInfo parent = Directory.GetParent(candidate);
            if (parent == null) break;
            exeDir = parent.FullName;
        }
        return AppContext.BaseDirectory;
    }

    private static bool StartNode(string nodeExe, string server, string appDir, out int port, out Check error)
    {
        port = 0;
        error = null;
        var info = new ProcessStartInfo(nodeExe)
        {
            Arguments = $"\"{server}\"",
            WorkingDirectory = Path.Combine(appDir, "app"),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        info.Environment["LINLI_PORT"] = "0";

        var ready = new ManualResetEventSlim(false);
        int foundPort = 0;
        string firstError = null;
        var stderr = new StringBuilder();

        var proc = new Process { StartInfo = info, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            const string marker = "LINLI_PORT=";
            if (e.Data.StartsWith(marker, StringComparison.Ordinal))
            {
                if (int.TryParse(e.Data.Substring(marker.Length).Trim(), out int p)) foundPort = p;
                ready.Set();
            }
        };
        proc.ErrorDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            stderr.AppendLine(e.Data);
            firstError ??= e.Data;
        };

        try
        {
            if (!proc.Start())
            {
                error = Check.Fail("E-NODE-NO-START", "没能拉起内置运行时。",
                    "重装一次就能修好；如果还不行，多半是安全软件把 node.exe 隔离开了。", "CreateProcess 返回 false");
                return false;
            }
        }
        catch (Exception ex)
        {
            error = Check.Fail("E-NODE-NO-START", "没能拉起内置运行时。",
                "重装一次就能修好；如果还不行，多半是安全软件把 node.exe 隔离开了。", ex.Message);
            return false;
        }

        _node = proc;
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        if (!ready.Wait(TimeSpan.FromSeconds(20)))
        {
            string why = firstError ?? (stderr.Length > 0 ? stderr.ToString() : "（没有任何输出）");
            error = Check.Fail("E-NODE-NO-PORT",
                "内置运行时起来了，但它一直没告诉我们要用哪个端口。",
                "最常见的原因是本机端口被占，或者上一次的林离没退干净、还在后台占着。\n" +
                "试试：退出托盘里的林离，再打开一次。", why);
            KillNode();
            return false;
        }

        port = foundPort;
        if (port <= 0)
        {
            error = Check.Fail("E-NODE-BAD-PORT", "内置运行时报了一个不能用的端口。",
                "重装一次就能修好。", "port=" + foundPort);
            KillNode();
            return false;
        }
        return true;
    }

    private static void KillNode()
    {
        try
        {
            if (_node != null && !_node.HasExited)
            {
                _node.Kill(true);
                _node.WaitForExit(3000);
            }
        }
        catch { /* 退出时不再纠缠 */ }
        _node = null;
    }

    // ---------------------------------------------------------------- 托盘 / 窗口

    private static void BuildTray(string appDir)
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开", null, (_, _) => OpenWindow());
        menu.Items.Add("打开数据目录", null, (_, _) =>
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LinliLetters");
            if (Directory.Exists(dir)) Process.Start("explorer.exe", dir);
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出", null, (_, _) => Shutdown());

        Icon icon = LoadIcon(appDir);
        _tray = new NotifyIcon { Icon = icon ?? SystemIcons.Application, Text = "林离的信", Visible = true, ContextMenuStrip = menu };
        _tray.DoubleClick += (_, _) => OpenWindow();
    }

    private static Icon LoadIcon(string appDir)
    {
        try
        {
            string path = Path.Combine(appDir, "app", "icon.ico");
            return File.Exists(path) ? new Icon(path) : null;
        }
        catch { return null; }
    }

    private static void OpenWindow()
    {
        try
        {
            string edge = FindEdge();
            if (!string.IsNullOrEmpty(edge))
            {
                // --app= 给出独立窗口：没有地址栏和标签页，看起来就是一个程序。
                Process.Start(new ProcessStartInfo(edge, $"--app={_url} --window-size=1180,820 --disable-features=msEdgeTranslations") { UseShellExecute = true });
                return;
            }
            Process.Start(new ProcessStartInfo(_url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"打不开界面：{ex.Message}\n也可以自己打开 {_url}", "林离的信", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private static string FindEdge()
    {
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
        };
        foreach (string path in candidates)
            if (File.Exists(path)) return path;
        return null;
    }

    private static void Shutdown()
    {
        KillNode();
        if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
        Application.Exit();
    }
}

/// <summary>一条自检结果：代号 + 一句人话 + 一个能自己动手修的办法 + 原始信息。</summary>
internal sealed class Check
{
    public bool Ok { get; private init; }
    public string Code { get; private init; } = "";
    public string Title { get; private init; } = "";
    public string Detail { get; private init; } = "";
    public string Fix { get; private init; } = "";
    public string Technical { get; private init; } = "";

    public static Check Pass() => new() { Ok = true };
    public static Check Fail(string code, string detail, string fix, string technical = null) =>
        new() { Ok = false, Code = code, Title = "林离没能起来。", Detail = detail, Fix = fix, Technical = technical ?? "" };
}

/// <summary>
/// 启动自检：进界面之前先把"能不能真的用"挨个查一遍。
/// 顺序按"最可能出问题、也最好修"排：文件在不在 → 数据目录能不能写 → 浏览器有没有。
/// </summary>
internal static class Preflight
{
    public static Check Run(string appDir, string nodeExe, string server)
    {
        if (!File.Exists(nodeExe) || !File.Exists(server))
        {
            var missing = new StringBuilder();
            if (!File.Exists(nodeExe)) missing.AppendLine(nodeExe);
            if (!File.Exists(server)) missing.AppendLine(server);
            return Check.Fail("E-FILES-MISSING",
                "少了运行要用到的文件。",
                "这一版没装完整，重装一次就好。\n" +
                "如果重装后还是这样，多半是安全软件把这两个文件删了 —— 把安装目录加进白名单再装一次。",
                missing.ToString().TrimEnd());
        }

        // ★ 数据目录写不进去 ⇒ 信写完了存不下。这必须在进界面**之前**说，
        //   等用户在界面里写完一封才发现存不了，那才是真坑。
        string dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LinliLetters");
        try
        {
            Directory.CreateDirectory(dataDir);
            string probe = Path.Combine(dataDir, ".write-probe.tmp");
            File.WriteAllText(probe, "probe");
            File.Delete(probe);
        }
        catch (Exception ex)
        {
            return Check.Fail("E-DATA-DIR-READONLY",
                "你的信件和设置存不进去。",
                $"数据目录是：{dataDir}\n" +
                "它写不进去，多半是被安全软件或磁盘权限挡住了。\n" +
                "把上面这个目录加进安全软件的白名单，或者换个有权限的账户再打开。",
                ex.Message);
        }

        return Check.Pass();
    }
}

/// <summary>第二个实例：把已经开着的那一个叫到前面来（best-effort，叫不动就算了）。</summary>
internal static class Native
{
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SW_RESTORE = 9;

    public static void BringExistingToFront()
    {
        try
        {
            IntPtr h = FindWindow(null, "林离的信");
            if (h == IntPtr.Zero) return;
            if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
            SetForegroundWindow(h);
        }
        catch { /* 叫不动就算了，托盘图标还在 */ }
    }
}
