//! Windows 原生 shell 集成。
//!
//! `play_video` 之前通过 `cmd /c start "" <path>` 走 cmd.exe 转发，绕了一道
//! 进程边界（cmd 解析命令行 + 加载 conhost + 查 PATH 找关联程序），点
//! "在系统播放器中打开" 时可见 ~300–800 ms 的卡顿。这里改用 Win32
//! `ShellExecuteW`——资源管理器右键"打开方式"、任务栏"打开"按钮背后的同
//! 一个 API，in-process 完成，毫秒级返回。

#[cfg(windows)]
pub fn shell_open(path: &str) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    // Win32 字符串要求 UTF-16 + NUL 终止。`encode_utf16` 不写终止符，
    // 必须手动 chain 一个 0 进去——这就是 `cmd /c start ""` 那个怪异
    // `""` 占位符的来历。
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: verb 与 target 都是 NUL 终止、生命周期覆盖整个调用，
    // ShellExecuteW 同步返回（关联程序由 shell 在另一个进程启动）。
    let result = unsafe {
        ShellExecuteW(
            None,                       // 父窗口
            PCWSTR(verb.as_ptr()),      // "open" 触发默认关联
            PCWSTR(target.as_ptr()),    // 目标文件绝对路径
            PCWSTR::null(),             // 参数（关联程序不需要）
            PCWSTR::null(),             // 工作目录（沿用当前）
            SW_SHOWNORMAL,              // 显示方式
        )
    };

    // ShellExecuteW 返回 HINSTANCE（指针大小整数）；> 32 = 成功，
    // ≤ 32 是错误码（SE_ERR_FNF=2、SE_ERR_ACCESSDENIED=5、
    // SE_ERR_ASSOCINCOMPLETE=27 等）。
    let code = result.0 as isize;
    if code <= 32 {
        return Err(format!(
            "ShellExecuteW failed: code {} (path: {})",
            code, path
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn shell_open(_path: &str) -> Result<(), String> {
    Err("shell_open is only implemented on Windows".to_string())
}
