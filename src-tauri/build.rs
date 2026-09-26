fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let mut native = cc::Build::new();
        if std::env::var_os("CARGO_FEATURE_WEBDRIVER").is_some() {
            native.define("IDEA_WEBDRIVER", None);
        }
        native
            .file("src/platform/macos.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("idea_mac");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
        println!("cargo:rerun-if-changed=src/platform/macos.m");
    }
    tauri_build::build();
}
