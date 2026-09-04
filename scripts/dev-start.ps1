Start-Process -FilePath "python" -ArgumentList "backend/main.py" -WindowStyle Hidden
Start-Process -FilePath "npm" -ArgumentList "run", "tauri", "dev" -WindowStyle Normal
