use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-env-changed=THE_BOSS_BUILD_ADMIN_UI");
    println!("cargo:rerun-if-changed=admin-ui");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set"));
    let admin_out = out_dir.join("admin-ui");
    fs::create_dir_all(&admin_out).expect("create admin-ui out dir");

    let build_ui = env::var("THE_BOSS_BUILD_ADMIN_UI")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
        || env::var("PROFILE").as_deref() == Ok("release");

    if build_ui {
        let admin_dir = PathBuf::from("admin-ui");
        if admin_dir.join("package.json").exists() {
            let _ = Command::new("pnpm")
                .arg("install")
                .arg("--ignore-workspace")
                .arg("--frozen-lockfile")
                .current_dir(&admin_dir)
                .status();
            if let Ok(status) = Command::new("pnpm")
                .arg("--ignore-workspace")
                .arg("build")
                .current_dir(&admin_dir)
                .status()
            {
                if status.success() {
                    copy_dir(&admin_dir.join("dist"), &admin_out).expect("copy admin-ui dist");
                    return;
                }
            }
        }
    }

    fs::write(
        admin_out.join("index.html"),
        r#"<!doctype html><html><head><meta charset="utf-8"><title>The Boss Control Plane</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="root"><h1>The Boss Control Plane</h1><p>Admin UI assets were not built for this debug/test binary.</p></main></body></html>"#,
    )
    .expect("write fallback admin ui");
}

fn copy_dir(from: &PathBuf, to: &PathBuf) -> std::io::Result<()> {
    if !from.exists() {
        return Ok(());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let from_path = entry.path();
        let to_path = to.join(entry.file_name());
        if from_path.is_dir() {
            copy_dir(&from_path, &to_path)?;
        } else {
            fs::copy(from_path, to_path)?;
        }
    }
    Ok(())
}
