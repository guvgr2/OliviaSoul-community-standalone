// 「林离的信」外壳。
//
// 职责只有三件：拉起内置 Node 跑本机服务 → 用 Edge 的应用窗口打开界面 → 退出时把 Node 收干净。
// 不做业务逻辑，不碰信件内容。
//
// 为什么用 Edge 应用窗口（--app=）：界面要靠 backdrop-filter 做玻璃质感，
// 只有浏览器引擎能渲染；Edge 每台 Windows 都有，不必再打包一个几十 MB 的内核。
// 没有 Edge 时退回默认浏览器，功能一样，只是没有独立窗口。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace LinliLetters;

internal static class Program
{
    private static NotifyIcon _tray;
    private static Process _node;
    private static string _url;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string appDir = ResolveAppDir();
        string nodeExe = Path.Combine(appDir, "runtime", "node", "node.exe");
        string server = Path.Combine(appDir, "app", "server.mjs");

        if (!File.Exists(nodeExe) || !File.Exists(server))
        {
            MessageBox.Show($"缺少运行文件：\n{nodeExe}\n{server}", "林离的信", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        if (!StartNode(nodeExe, server, appDir, out int port, out string error))
        {
            MessageBox.Show($"没能启动本机服务：\n{error}", "林离的信", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        _url = $"http://127.0.0.1:{port}/";
        BuildTray(appDir);
        OpenWindow();
        Application.Run();
    }

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

    private static bool StartNode(string nodeExe, string server, string appDir, out int port, out string error)
    {
        port = 0;
        error = "";
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
        var stderr = new StringBuilder();

        _node = new Process { StartInfo = info, EnableRaisingEvents = true };
        _node.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            const string marker = "LINLI_PORT=";
            if (e.Data.StartsWith(marker, StringComparison.Ordinal))
            {
                if (int.TryParse(e.Data.Substring(marker.Length).Trim(), out int p)) foundPort = p;
                ready.Set();
            }
        };
        _node.ErrorDataReceived += (_, e) => { if (!string.IsNullOrEmpty(e.Data)) stderr.AppendLine(e.Data); };

        try
        {
            if (!_node.Start()) { error = "进程启动失败"; return false; }
            _node.BeginOutputReadLine();
            _node.BeginErrorReadLine();
            if (!ready.Wait(TimeSpan.FromSeconds(20)))
            {
                error = stderr.Length > 0 ? stderr.ToString() : "等待端口超时";
                return false;
            }
            port = foundPort;
            return port > 0;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

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
        try
        {
            if (_node != null && !_node.HasExited)
            {
                _node.Kill(true);
                _node.WaitForExit(3000);
            }
        }
        catch { /* 退出时不再纠缠 */ }

        if (_tray != null) { _tray.Visible = false; _tray.Dispose(); }
        Application.Exit();
    }
}
