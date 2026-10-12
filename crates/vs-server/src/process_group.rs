//! Всё, что запускает студия, умирает вместе со студией.
//!
//! Деструкторы сайдкаров (llama-server, bs_roformer-cli, whisper, ffmpeg) не
//! срабатывают, когда процесс снимают диспетчером задач, `taskkill /F`, падением или закрытием окна
//! при живом рабочем потоке. Единственный честный ответ Windows — job object с
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: процесс кладёт в него себя, все дети наследуют job при
//! создании, и когда процесс заканчивается как угодно, ядро закрывает последний хендл и гасит всю группу.

use std::process::Command;

/// Кладёт этот процесс и всё, что он запустит дальше, в одну группу с kill-on-close.
///
/// Неудача не фатальна: процесс внутри чужого job, где вложение запрещено, просто живёт по-старому
/// (дети гасятся своими деструкторами).
#[cfg(windows)]
pub fn bind_children_to_this_process() -> bool {
    use std::mem::size_of;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    if JOB.get().is_some() {
        return true;
    }
    unsafe {
        let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return false;
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        // BREAKAWAY_OK сам никого не выпускает: из группы выходит только процесс, запущенный с
        // CREATE_BREAKAWAY_FROM_JOB (см. detach_from_group).
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        let assigned = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) != 0
            && AssignProcessToJobObject(job, GetCurrentProcess()) != 0;

        // Хендл намеренно не закрывается: job должен жить до конца процесса и умереть вместе с ним,
        // что и делает закрытие последнего хендла на выходе.
        if assigned {
            let _ = JOB.set(job as isize);
        }
        assigned
    }
}

#[cfg(not(windows))]
pub fn bind_children_to_this_process() -> bool {
    false
}

#[cfg(windows)]
static JOB: std::sync::OnceLock<isize> = std::sync::OnceLock::new();

/// Разрешает процессам, запущенным с этого момента, пережить этот.
///
/// Установщик обновления запускается этим процессом прямо перед выходом; в группе kill-on-close он
/// умер бы вместе со студией, ничего не установив. Живые сайдкары после этого пережили бы студию —
/// перед вызовом их гасит terminate_group_members. BREAKAWAY_OK остаётся: detach_from_group продолжает
/// ставить CREATE_BREAKAWAY_FROM_JOB.
#[cfg(windows)]
pub fn release_children() -> bool {
    use std::mem::size_of;

    use windows_sys::Win32::System::JobObjects::{
        JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    };

    let Some(job) = JOB.get() else { return false };
    unsafe {
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        SetInformationJobObject(
            *job as _,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) != 0
    }
}

/// Гасит все процессы группы, кроме этого (сайдкары: llama-server, ffmpeg, bs_roformer-cli, whisper).
#[cfg(windows)]
pub fn terminate_group_members() {
    let Some(&job) = JOB.get() else { return };
    use std::mem::size_of;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{JobObjectBasicProcessIdList, QueryInformationJobObject};
    use windows_sys::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    #[repr(C)]
    struct PidList {
        assigned: u32,
        listed: u32,
        pids: [usize; 1024],
    }

    let me = unsafe { GetCurrentProcessId() } as usize;
    let mut list = PidList { assigned: 0, listed: 0, pids: [0; 1024] };
    let ok = unsafe {
        QueryInformationJobObject(
            job as _,
            JobObjectBasicProcessIdList,
            (&raw mut list).cast(),
            size_of::<PidList>() as u32,
            std::ptr::null_mut(),
        ) != 0
    };
    if !ok {
        eprintln!("[ERROR] the studio process group list was not read: sidecars may outlive the exit");
        return;
    }
    for &pid in list.pids.iter().take(list.listed as usize) {
        if pid == me {
            continue;
        }
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid as u32);
            if h.is_null() {
                eprintln!("[ERROR] process {pid} of the studio group was not opened for termination");
                continue;
            }
            if TerminateProcess(h, 1) == 0 {
                eprintln!("[ERROR] process {pid} of the studio group was not terminated");
            }
            CloseHandle(h);
        }
    }
}

#[cfg(not(windows))]
pub fn release_children() -> bool {
    false
}

#[cfg(not(windows))]
pub fn terminate_group_members() {}

/// Запускаемое наружу для пользователя (системный плеер, окно проводника) не должно закрываться
/// вместе со студией. Флаг ставится только когда группа своя: в чужом job без BREAKAWAY_OK
/// CreateProcess с ним падает с отказом в доступе.
#[cfg(windows)]
pub fn detach_from_group(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_BREAKAWAY_FROM_JOB;

    if JOB.get().is_some() {
        cmd.creation_flags(CREATE_BREAKAWAY_FROM_JOB);
    }
    cmd
}

#[cfg(not(windows))]
pub fn detach_from_group(cmd: &mut Command) -> &mut Command {
    cmd
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::process::{Child, Stdio};
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::JobObjects::{
        IsProcessInJob, JobObjectExtendedLimitInformation, QueryInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    };

    const OWNER_ENV: &str = "DUB_PROCESS_GROUP_OWNER";
    const TERMINATOR_ENV: &str = "DUB_PROCESS_GROUP_TERMINATOR";

    fn long_child(detached: bool) -> Child {
        let mut cmd = Command::new("ping");
        cmd.args(["-n", "60", "127.0.0.1"]).stdout(Stdio::null()).stderr(Stdio::null());
        if detached {
            detach_from_group(&mut cmd);
        }
        cmd.spawn().expect("запуск ping")
    }

    fn in_our_job(child: &Child) -> bool {
        let job = *JOB.get().expect("группа создана");
        let mut result = 0;
        let ok = unsafe { IsProcessInJob(child.as_raw_handle() as _, job as _, &mut result) };
        assert_ne!(ok, 0, "IsProcessInJob: {}", std::io::Error::last_os_error());
        result != 0
    }

    fn limit_flags() -> u32 {
        let job = *JOB.get().expect("группа создана");
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            QueryInformationJobObject(
                job as _,
                JobObjectExtendedLimitInformation,
                (&raw mut info).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                std::ptr::null_mut(),
            )
        };
        assert_ne!(ok, 0, "QueryInformationJobObject: {}", std::io::Error::last_os_error());
        info.BasicLimitInformation.LimitFlags
    }

    #[test]
    fn children_inherit_the_group_unless_detached_and_release_lifts_the_kill() {
        assert!(bind_children_to_this_process(), "процесс тестов не встал в свой job");
        let flags = limit_flags();
        assert_ne!(flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 0);
        assert_ne!(flags & JOB_OBJECT_LIMIT_BREAKAWAY_OK, 0);

        let mut inherited = long_child(false);
        let mut detached = long_child(true);
        let inherited_in = in_our_job(&inherited);
        let detached_in = in_our_job(&detached);
        for c in [&mut inherited, &mut detached] {
            c.kill().ok();
            c.wait().ok();
        }
        assert!(inherited_in, "обычный потомок должен наследовать группу");
        assert!(!detached_in, "detach_from_group должен выводить процесс из группы");

        assert!(release_children());
        let flags = limit_flags();
        assert_eq!(flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 0);
        assert_ne!(flags & JOB_OBJECT_LIMIT_BREAKAWAY_OK, 0, "после release вывод из группы должен оставаться разрешённым");
    }

    /// Владелец группы для terminate_kills_members_but_not_the_owner: отдельный процесс, чтобы не гасить
    /// детей соседних тестов этого процесса.
    #[test]
    #[ignore = "запускается из terminate_kills_members_but_not_the_owner"]
    fn terminating_owner() {
        if std::env::var_os(TERMINATOR_ENV).is_none() {
            return;
        }
        assert!(bind_children_to_this_process());
        let mut child = long_child(false);
        terminate_group_members();
        let exited = (0..50).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            matches!(child.try_wait(), Ok(Some(_)))
        });
        println!("CHILD_EXITED={exited}");
    }

    #[test]
    fn terminate_kills_members_but_not_the_owner() {
        let exe = std::env::current_exe().expect("путь тестового exe");
        let out = Command::new(exe)
            .args(["process_group::tests::terminating_owner", "--exact", "--ignored", "--nocapture"])
            .env(TERMINATOR_ENV, "1")
            .stderr(Stdio::null())
            .output()
            .expect("запуск владельца группы");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("CHILD_EXITED=true"), "потомок группы не погашен: {text}");
        assert!(out.status.success(), "владелец погасил сам себя: {text}");
    }

    /// Владелец группы для a_killed_owner_takes_its_children_down: запускается им как отдельный
    /// процесс (этот же тестовый exe), сам по себе ничего не делает.
    #[test]
    #[ignore = "запускается из a_killed_owner_takes_its_children_down"]
    fn group_owner() {
        if std::env::var_os(OWNER_ENV).is_none() {
            return;
        }
        assert!(bind_children_to_this_process());
        let mut child = long_child(false);
        println!("GRANDCHILD={}", child.id());
        std::thread::sleep(std::time::Duration::from_secs(60));
        child.kill().ok();
        child.wait().ok();
    }

    #[test]
    fn a_killed_owner_takes_its_children_down() {
        let exe = std::env::current_exe().expect("путь тестового exe");
        let mut owner = Command::new(exe)
            .args(["process_group::tests::group_owner", "--exact", "--ignored", "--nocapture"])
            .env(OWNER_ENV, "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("запуск владельца группы");
        let out = owner.stdout.take().expect("stdout владельца");
        let pid = BufReader::new(out)
            .lines()
            .map_while(Result::ok)
            .find_map(|l| l.strip_prefix("GRANDCHILD=").and_then(|p| p.trim().parse::<u32>().ok()))
            .expect("владелец не сообщил pid потомка");
        // Хендл открывается до убийства владельца: pid потомка не успеет достаться другому процессу.
        let grandchild =
            unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        assert!(!grandchild.is_null(), "OpenProcess: {}", std::io::Error::last_os_error());

        owner.kill().expect("убить владельца");
        owner.wait().ok();
        let waited = unsafe { WaitForSingleObject(grandchild, 10_000) };
        unsafe { CloseHandle(grandchild) };
        assert_eq!(waited, WAIT_OBJECT_0, "потомок пережил убитого владельца группы");
    }
}
