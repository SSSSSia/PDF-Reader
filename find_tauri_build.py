with open(r'D:\CODE_FILE\CODE_AI\PDF-Reader\src-tauri\Cargo.lock') as f:
    content = f.read()
idx = content.find('name = "tauri-build"')
if idx >= 0:
    section = content[idx:idx+300]
    print(section)
else:
    print("tauri-build not found in Cargo.lock")
