"""세마넴 공식 사진·영상을 내 PC에만 모으는 스크립트 (최근 N일).

받은 파일은 구글 드라이브 '내 드라이브/세마넴_보관함'(PC용 구글 드라이브 앱 필요)에 저장된다.
앱이 없으면 ~/세마넴_보관함 에 저장된다. 외부에 올리지 않는다.

준비 (한 번만):
    pip install -U yt-dlp gallery-dl
    # X 사진은 로그인이 필요: 크롬에서 x.com 에 로그인해 두면 쿠키를 자동으로 씀

실행:
    python collect.py            # 최근 30일
    python collect.py --days 7   # 최근 7일
    python collect.py --browser firefox   # 크롬 말고 다른 브라우저 쿠키
"""
import argparse
import datetime as dt
import pathlib
import subprocess
import sys

YOUTUBE = ["https://www.youtube.com/@sa2m2nam3/videos", "https://www.youtube.com/@sa2m2nam3/shorts"]
X_ACCOUNTS = ["sa2m2nam3", "sa2m2nam3_JP"]


def default_out():
    """구글 드라이브 PC 앱이 있으면 '내 드라이브/세마넴_보관함'에 저장 → 드라이브로 자동 업로드."""
    for c in [pathlib.Path("G:/내 드라이브"), pathlib.Path("G:/My Drive"),
              *pathlib.Path.home().glob("Library/CloudStorage/GoogleDrive-*/*")]:
        if c.is_dir():
            return str(c / "세마넴_보관함")
    return str(pathlib.Path.home() / "세마넴_보관함")


def run(cmd):
    print("\n>", " ".join(cmd))
    subprocess.run(cmd, check=False)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=30)
    p.add_argument("--out", default=default_out())
    p.add_argument("--browser", default="chrome")
    a = p.parse_args()

    out = pathlib.Path(a.out)
    since = (dt.date.today() - dt.timedelta(days=a.days)).strftime("%Y%m%d")
    archive = out / ".받은목록.txt"  # 이미 받은 건 다시 안 받음
    out.mkdir(parents=True, exist_ok=True)

    # 1) 유튜브 공식 채널 영상·쇼츠 (최고 화질, mp4)
    for url in YOUTUBE:
        run([sys.executable, "-m", "yt_dlp", url,
             "--dateafter", since, "--break-match-filters", f"upload_date>={since}",
             "--cookies-from-browser", a.browser,
             "-f", "bv*+ba/b", "--merge-output-format", "mp4",
             "--write-thumbnail", "--download-archive", str(archive),
             "-o", str(out / "유튜브" / "%(upload_date)s_%(title).80B [%(id)s].%(ext)s")])

    # 2) X 공식 계정 사진·영상 (원본 화질)
    for acc in X_ACCOUNTS:
        run([sys.executable, "-m", "gallery_dl", f"https://x.com/{acc}/media",
             "--cookies-from-browser", a.browser,
             "--filter", f"date >= datetime({since[:4]}, {int(since[4:6])}, {int(since[6:])})",
             "--download-archive", str(out / ".받은목록.sqlite3"),
             "-D", str(out / "X" / acc),
             "-o", "filename={date:%Y%m%d}_{tweet_id}_{num}.{extension}"])

    print(f"\n완료: {out}")


if __name__ == "__main__":
    main()
