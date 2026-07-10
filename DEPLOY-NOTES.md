# SourceAI Landing Page — Deploy Notes

## Folder location
C:\Users\paulk\sourceai-site

## Repo
https://github.com/Ketochownz/sourceai-landing

## Every time you edit index.html and want to publish the change:

Open a terminal in C:\Users\paulk\sourceai-site, then run:

```
git add index.html
git commit -m "update"
git push
```

That's it. Vercel is connected to this repo and will auto-redeploy within seconds of the push.

## First-time setup (already done — only needed once, keeping for reference)

```
cd "C:\Users\paulk\sourceai-site"
git init
git remote add origin https://github.com/Ketochownz/sourceai-landing.git
git branch -M main
git add index.html
git commit -m "Update landing page"
git push -u origin main --force
```

## Notes / gotchas
- Make sure you're actually inside C:\Users\paulk\sourceai-site before running git commands —
  running git init in your user root folder (C:\Users\paulk) by mistake will NOT work and
  should be avoided. If that happens again: cd into the right folder first, or delete the
  stray .git folder with `Remove-Item -Recurse -Force .git` from wherever it was created.
- Domain: sourceai.co.nz — DNS is pointed at Vercel already, no need to touch DNS again
  unless the Vercel project changes.
- Email (Microsoft 365) DNS records (MX, autodiscover, SPF, MS= TXT) are separate from the
  website A/CNAME records — never delete those when managing the site's DNS.
