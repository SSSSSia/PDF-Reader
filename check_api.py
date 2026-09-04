import json
with open(r'D:\CODE_FILE\CODE_AI\PDF-Reader\node_modules\@tauri-apps\api\package.json') as f:
    p = json.load(f)
print('type:', p.get('type', 'N/A'))
print('main:', p.get('main', 'N/A'))
print('module:', p.get('module', 'N/A'))
