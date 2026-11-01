"""Minimal VT screen for dsh-tui PTY captures."""

from __future__ import annotations

import re


class Screen:
    def __init__(self, rows: int = 40, cols: int = 120) -> None:
        self.rows = rows
        self.cols = cols
        self.buf = [[" "] * cols for _ in range(rows)]
        self.r = 0
        self.c = 0
        self._osc = False
        self._esc = False
        self._csi = False
        self._csi_buf = ""

    def feed(self, data: str) -> None:
        for ch in data:
            self._feed_char(ch)

    def text(self) -> str:
        lines = ["".join(row).rstrip() for row in self.buf]
        while lines and lines[-1] == "":
            lines.pop()
        return "\n".join(lines)

    def _put(self, ch: str) -> None:
        if self.r >= self.rows:
            self._scroll(1)
            self.r = self.rows - 1
        if self.c >= self.cols:
            self.c = 0
            self.r += 1
            if self.r >= self.rows:
                self._scroll(1)
                self.r = self.rows - 1
        self.buf[self.r][self.c] = ch
        self.c += 1

    def _scroll(self, n: int) -> None:
        if n <= 0:
            return
        self.buf = self.buf[n:] + [[" "] * self.cols for _ in range(n)]

    def _clamp(self) -> None:
        self.r = max(0, min(self.rows - 1, self.r))
        self.c = max(0, min(self.cols - 1, self.c))

    def _erase_display(self, mode: str) -> None:
        if mode in ("", "0"):
            self._erase_line("0")
            for rr in range(self.r + 1, self.rows):
                self.buf[rr] = [" "] * self.cols
        elif mode == "1":
            self._erase_line("1")
            for rr in range(0, self.r):
                self.buf[rr] = [" "] * self.cols
        elif mode == "2" or mode == "3":
            self.buf = [[" "] * self.cols for _ in range(self.rows)]

    def _erase_line(self, mode: str) -> None:
        row = self.buf[self.r]
        if mode in ("", "0"):
            for cc in range(self.c, self.cols):
                row[cc] = " "
        elif mode == "1":
            for cc in range(0, self.c + 1):
                row[cc] = " "
        elif mode == "2":
            self.buf[self.r] = [" "] * self.cols

    def _csi_dispatch(self, seq: str) -> None:
        if not seq:
            return
        final = seq[-1]
        params = seq[:-1]
        if final in ("h", "l", "m", "q"):
            return
        if final == "H" or final == "f":
            parts = params.split(";") if params else []
            row = int(parts[0] or "1") if parts else 1
            col = int(parts[1] or "1") if len(parts) > 1 else 1
            self.r = row - 1
            self.c = col - 1
            self._clamp()
            return
        if final == "A":
            n = int(params or "1")
            self.r -= n
            self._clamp()
            return
        if final == "B":
            n = int(params or "1")
            self.r += n
            self._clamp()
            return
        if final == "C":
            n = int(params or "1")
            self.c += n
            self._clamp()
            return
        if final == "D":
            n = int(params or "1")
            self.c -= n
            self._clamp()
            return
        if final == "G":
            n = int(params or "1")
            self.c = n - 1
            self._clamp()
            return
        if final == "d":
            n = int(params or "1")
            self.r = n - 1
            self._clamp()
            return
        if final == "J":
            self._erase_display(params)
            return
        if final == "K":
            self._erase_line(params)
            return
        if final == "X":
            n = int(params or "1")
            row = self.buf[self.r]
            for cc in range(self.c, min(self.cols, self.c + n)):
                row[cc] = " "
            return

    def _feed_char(self, ch: str) -> None:
        if self._osc:
            if ch == "\x07":
                self._osc = False
            elif ch == "\x1b":
                self._osc = False
                self._esc = True
            return
        if self._csi:
            self._csi_buf += ch
            if "@" <= ch <= "~":
                self._csi = False
                self._csi_dispatch(self._csi_buf)
                self._csi_buf = ""
            return
        if self._esc:
            self._esc = False
            if ch == "[":
                self._csi = True
                self._csi_buf = ""
                return
            if ch == "]":
                self._osc = True
                return
            return
        if ch == "\x1b":
            self._esc = True
            return
        if ch == "\r":
            self.c = 0
            return
        if ch == "\n":
            self.r += 1
            if self.r >= self.rows:
                self._scroll(1)
                self.r = self.rows - 1
            return
        if ch == "\b":
            if self.c > 0:
                self.c -= 1
            return
        if ch == "\t":
            self.c = min(self.cols - 1, (self.c + 8) & ~7)
            return
        if ch < " " or ch == "\x7f":
            return
        self._put(ch)


def strip_visible(data: str) -> str:
    screen = Screen()
    screen.feed(data)
    return screen.text()
