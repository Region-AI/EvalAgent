{
  "includes": [],
  "targets": [
    {
      "target_name": "native_capture",
      "sources": [
        "binding.cc",
        "exclude.cpp",
        "capture.cpp"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "libraries": [
        "user32.lib",
        "gdi32.lib",
        "dwmapi.lib"
      ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 0
        }
      }
    }
  ]
}
