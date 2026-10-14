// 「OliviaSoul-community独立版」的主窗口。
//
// ★ 为什么要有这个文件：以前界面是外壳用 Edge 的 `--app=` 打开的。那种窗口
//   - 任务栏上写的是 Edge，图标取的是网页 favicon（没有就是 Edge 的地球）；
//   - 不能真正收进托盘，关掉就是关掉；
//   - 用户看到的"没有程序"、以及被报了两次的"还是默认图标"，根子都在这。
//   现在是**我们自己的窗口**：无边框、自绘，图标和标题都是这个程序自己的。
//
// ★ 用 WebView2 而不是自己画界面：界面靠 backdrop-filter 做玻璃质感，
//   只有浏览器引擎能渲染。WebView2 用的是系统里已经装好的运行时（本机 154/155 都在），
//   不必再往包里塞一个几十 MB 的内核。
//
// ★ 无边框窗口的三件事必须自己做，Windows 不会再替你做：拖动、最小化、关闭。
//   做法是页面用 window.chrome.webview.postMessage 发一句话过来，这边照做。

using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LinliLetters;

internal sealed class MainWindow : Form
{
    private WebView2 _web;

    /// <summary>用户点了右上角那个「—」：收进托盘，程序不退出。</summary>
    public event EventHandler RequestHide;
    /// <summary>用户点了右上角那个「×」：默认也只收进托盘（陪伴类程序的习惯）。</summary>
    public event EventHandler RequestClose;
    /// <summary>用户明确要退出（托盘菜单或页面里的「退出」）。</summary>
    public event EventHandler RequestQuit;

    public MainWindow(string url, Icon icon)
    {
        Text = App.Title;
        Icon = icon ?? SystemIcons.Application;

        // ★ 无边框。边框一留，玻璃界面外面就多一圈 Windows 的灰边，"程序感"没了。
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(14, 13, 17);   // 跟页面底色一致，免得加载时闪一块白

        // 按屏幕大小收敛：别在小屏上开出一个放不下的窗口。
        Rectangle area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        int w = Math.Min(1180, Math.Max(880, area.Width - 120));
        int h = Math.Min(820, Math.Max(620, area.Height - 90));
        Size = new Size(w, h);

        _web = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_web);

        _web.CoreWebView2InitializationCompleted += (_, _) => { /* 拿到了内核再导航 */ };
        _web.WebMessageReceived += OnWebMessage;

        Load += async (_, _) =>
        {
            try
            {
                // ★ 用户数据目录必须显式给一个本机的固定位置。
                //   不给的话 WebView2 会在 exe 旁边建目录 —— 装在 Program Files 下会写不进去，
                //   而且卸载时会漏下一堆东西。放在数据目录里，跟信件一个待遇。
                string dataDir = Path.Combine(App.DataDir, "webview2");
                Directory.CreateDirectory(dataDir);
                var env = await CoreWebView2Environment.CreateAsync(userDataFolder: dataDir);
                await _web.EnsureCoreWebView2Async(env);

                _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;  // 别弹出浏览器的右键菜单
                _web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                _web.CoreWebView2.NavigationCompleted += (_, _) => { /* 页面loaded，暂不需要额外动作 */ };
                _web.CoreWebView2.NewWindowRequested += (_, e) =>
                {
                    // 页面要开外链：交给系统默认浏览器，别在我们这个窗口里开。
                    e.Handled = true;
                    try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true }); }
                    catch { /* 开不了就算了 */ }
                };

                _web.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                // 内核起不来 ⇒ 退回系统浏览器。功能一样，只是没有独立窗口。
                FallbackToBrowser(url, ex);
            }
        };
    }

    private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string msg;
        try { msg = e.TryGetWebMessageAsString(); } catch { return; }
        switch (msg)
        {
            case "drag":    StartDrag(); break;
            case "min":     RequestHide?.Invoke(this, EventArgs.Empty); break;
            case "close":   RequestClose?.Invoke(this, EventArgs.Empty); break;
            case "quit":    RequestQuit?.Invoke(this, EventArgs.Empty); break;
        }
    }

    /// <summary>无边框窗口要自己实现拖动：骗 Windows 一下，说"按在了标题栏上"。</summary>
    private void StartDrag()
    {
        const int WM_NCLBUTTONDOWN = 0xA1;
        const int HTCAPTION = 0x2;
        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }

    private void FallbackToBrowser(string url, Exception ex)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            RequestHide?.Invoke(this, EventArgs.Empty);
            MessageBox.Show(
                "内置的浏览内核没起来，先用系统浏览器打开了界面。\n" +
                "功能一样，只是没有独立窗口。\n\n（" + ex.Message + "）",
                App.Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch { /* 连浏览器也起不来 —— 托盘还在，用户可以从那里拿地址 */ }
    }

    // ------------------------------------------------------------------ Win32

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    protected override void Dispose(bool disposing)
    {
        if (disposing) _web?.Dispose();
        base.Dispose(disposing);
    }
}
