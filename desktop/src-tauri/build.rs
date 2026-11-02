fn commit_hash() -> String {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

fn main() {
    let hash = commit_hash();
    println!("cargo:rerun-if-env-changed=COMMIT_HASH");
    println!("cargo:rustc-env=COMMIT_HASH={}", hash);

    // Analytics
    println!("cargo:rerun-if-env-changed=APTABASE_KEY");

    // ScreenCaptureKit is weak-linked: Tyto still starts below macOS 12.3, where the
    // framework is missing (video is offered from macOS 13 only). The same flag in the
    // screencapturekit build script does not reach our binary: link args are per package.
    // Its Swift bridge loads the Swift runtime (`@rpath/libswift_Concurrency.dylib`
    // and others) from the system: without this rpath Tyto would not start at all.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_build::build();
}
