/*
 * PRTS Windows self-extracting installer stub.
 *
 * The distribution script appends the payload zip after the ASCII magic
 * "PRTSPAYLOAD0". At run time this stub:
 *   1. locates the magic inside its own exe,
 *   2. writes payload.zip + bootstrap.cmd into %TEMP%\PRTS-Setup-<pid>,
 *   3. runs bootstrap.cmd (extracts with tar, falls back to PowerShell) and
 *      waits for the installer to finish,
 *   4. leaves the extracted directory in place (removable manually).
 *
 * Build (Linux, mingw-w64):
 *   x86_64-w64-mingw32-gcc -Os -s -o PRTS-Setup.exe sfx.c -municode -luser32 -lshell32
 * plus the icon resource:
 *   x86_64-w64-mingw32-windres prts.rc res.o && link res.o
 */
#include <windows.h>
#include <stdio.h>
#include <string.h>

static const char MAGIC[] = "PRTSPAYLOAD0";
#define MAGIC_LEN (sizeof(MAGIC) - 1)

static BOOL write_all(const char *path, const unsigned char *data, DWORD len) {
  HANDLE f = CreateFileA(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (f == INVALID_HANDLE_VALUE) return FALSE;
  DWORD done = 0;
  BOOL ok = WriteFile(f, data, len, &done, NULL);
  CloseHandle(f);
  return ok && done == len;
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nCmdShow) {
  (void)hInst; (void)hPrev; (void)lpCmdLine; (void)nCmdShow;
  char self[MAX_PATH];
  if (!GetModuleFileNameA(NULL, self, sizeof(self))) {
    MessageBoxA(NULL, "PRTS: cannot locate the installer file.", "PRTS Setup", MB_ICONERROR);
    return 1;
  }
  HANDLE f = CreateFileA(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (f == INVALID_HANDLE_VALUE) {
    MessageBoxA(NULL, "PRTS: cannot open the installer file.", "PRTS Setup", MB_ICONERROR);
    return 1;
  }
  DWORD size = GetFileSize(f, NULL);
  if (size == INVALID_FILE_SIZE || size < MAGIC_LEN) { CloseHandle(f); return 1; }
  unsigned char *buf = (unsigned char *)HeapAlloc(GetProcessHeap(), 0, size);
  if (!buf) { CloseHandle(f); return 1; }
  DWORD read = 0;
  if (!ReadFile(f, buf, size, &read, NULL) || read != size) { CloseHandle(f); return 1; }
  CloseHandle(f);

  /* Find the magic; payload starts right after it. */
  DWORD off = 0;
  int found = 0;
  for (DWORD i = 0; i + MAGIC_LEN <= size; i++) {
    if (memcmp(buf + i, MAGIC, MAGIC_LEN) == 0) { off = i + MAGIC_LEN; found = 1; break; }
  }
  if (!found) {
    MessageBoxA(NULL, "PRTS: payload not found in this installer.", "PRTS Setup", MB_ICONERROR);
    return 1;
  }

  /* Temp work dir. */
  char tmp[MAX_PATH], dir[MAX_PATH];
  GetTempPathA(sizeof(tmp), tmp);
  wsprintfA(dir, "%sPRTS-Setup-%lu", tmp, (unsigned long)GetCurrentProcessId());
  CreateDirectoryA(dir, NULL);

  char zipPath[MAX_PATH], batPath[MAX_PATH];
  wsprintfA(zipPath, "%s\\payload.zip", dir);
  wsprintfA(batPath, "%s\\bootstrap.cmd", dir);
  if (!write_all(zipPath, buf + off, size - off)) {
    MessageBoxA(NULL, "PRTS: could not write the payload.", "PRTS Setup", MB_ICONERROR);
    return 1;
  }
  HeapFree(GetProcessHeap(), 0, buf);

  /* bootstrap.cmd: extract (tar on Win10+, PowerShell fallback) then install. */
  const char *bat =
    "@echo off\r\n"
    "cd /d \"%~dp0\"\r\n"
    "if not exist payload.zip goto missing\r\n"
    "tar -xf payload.zip >nul 2>nul\r\n"
    "if errorlevel 1 powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Force -LiteralPath 'payload.zip' -DestinationPath '.'\"\r\n"
    "if not exist installer.ps1 goto missing\r\n"
    "if not exist prts-launch.vbs goto missing\r\n"
    "wscript.exe //B prts-launch.vbs\r\n"
    "exit /b 0\r\n"
    ":missing\r\n"
    "echo PRTS: extracted files are incomplete. Re-download the installer and retry.\r\n"
    "pause\r\n"
    "exit /b 1\r\n";
  if (!write_all(batPath, (const unsigned char *)bat, (DWORD)strlen(bat))) {
    MessageBoxA(NULL, "PRTS: could not write the bootstrap script.", "PRTS Setup", MB_ICONERROR);
    return 1;
  }

  /* Run the installer in a visible console and wait. */
  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  ZeroMemory(&pi, sizeof(pi));
  char cmdline[1024];
  wsprintfA(cmdline, "cmd.exe /c \"\"%s\"\"", batPath);
  if (!CreateProcessA(NULL, cmdline, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, dir, &si, &pi)) {
    MessageBoxA(NULL, "PRTS: could not start the installer.", "PRTS Setup", MB_ICONERROR);
    return 1;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return (int)code;
}
