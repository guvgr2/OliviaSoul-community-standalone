// 这个程序自己的"身份证"：名字、互斥量、数据目录。
// ★ 名字只在这里写一处。窗口标题、托盘提示、错误框标题、以及"找已经开着的那一个"
//   全部读它 —— 以前这些字符串各写各的，改名字时漏一处，第二个实例就叫不醒第一个。

using System;
using System.IO;

namespace LinliLetters;

internal static class App
{
    /// <summary>对外显示的名字。动这里，界面/托盘/安装程序/协议要一起动。</summary>
    public const string Title = "OliviaSoul-community独立版";

    /// <summary>
    /// 互斥量。安装程序用它认出"程序正在跑"，装之前先请它退出（install.iss 的 AppMutex）。
    /// ★ 这是**内部标识**，改名时不动它 —— 动了就等于换了一个程序，旧的卸载项会失联。
    /// </summary>
    public const string MutexName = "LinliLetters.App";

    /// <summary>信件、设置、账本都在这里。卸载不删它。</summary>
    public static string DataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LinliLetters");
}
