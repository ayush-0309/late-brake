# The daily run

What the scheduled routine does every night at 3:30am India time: it writes the day's four posts, each set to go
live at its own time. Read `posts/_guide.md` first and follow it exactly: this file is only the procedure.

**Review: none.** The posts go straight onto `main` and publish at their slots without anyone approving them. To have
a person approve each day's posts first, change this line to "Review: pull request" (step 5 explains both).

## The day's schedule

Each post's `date:` is today's date (India time) plus its slot. The publish-blog GitHub Action checks every 15
minutes and puts each post live within about 15 minutes of its slot (straight away if the slot has already passed).

| Slot | `date:` | Post |
|---|---|---|
| Morning | `YYYY-MM-DD 09:00` | News: the biggest story since yesterday |
| Lunchtime | `YYYY-MM-DD 12:00` | On this day |
| Afternoon | `YYYY-MM-DD 15:00` | News: the second biggest story, or a history post if there isn't one |
| Evening | `YYYY-MM-DD 18:00` | History or fun facts, taking turns day by day |

## 1. Find the news

Look at what was published in the last 24 hours (72 hours on a Monday, to cover the race weekend) in these feeds:

- BBC Sport: https://feeds.bbci.co.uk/sport/formula1/rss.xml
- Autosport: https://www.autosport.com/rss/f1/news/
- Motorsport.com: https://www.motorsport.com/rss/f1/news/
- The Race: https://www.the-race.com/category/formula-1/feed/

For official decisions (penalties, rules, calendar) check Formula 1's own news (https://www.formula1.com/en/latest/all)
and the FIA (https://www.fia.com/news).

Read the feeds with `curl -s -L -A 'LateBrakeBlog/1.0 (https://www.latebrake.in/contact.html)' <url>`: the WebFetch tool
can't open the BBC feed. WebFetch is fine for reading articles and Wikipedia pages.

## 2. Pick the four posts

Check the titles and descriptions of posts in `posts/` from the last 14 days so nothing repeats.

For news, choose the biggest stories the blog hasn't covered yet, in order of preference:

1. Race, sprint and qualifying results, and the title fight.
2. Confirmed announcements from teams, drivers, Formula 1 or the FIA (signings, penalties, rule and calendar changes).
3. Stories with a clear link to one of the game's circuits.

Skip rumours, "sources say" transfer gossip, anything about drivers' health or private lives, and opinion pieces.
If there's only one news story worth writing, the afternoon slot becomes a history post; if there's none, the
morning slot does too. Never write more than four posts.

For "On this day", use today's date (India time) and pick two or three notable moments from past seasons. For history
and fun facts, pick something that hasn't been covered and, when you can, ties into this week's race or one of the
game's circuits.

## 3. Check the facts

News: every result, time, gap and quote must appear in at least two of the sources above, or in one official source
(Formula 1, the FIA or the team). History and fun facts: check each fact against Wikipedia's page for that race or
driver, or Formula 1's own site. Note which sources you used; every one gets linked at the end of the post. If
something can't be confirmed, leave it out.

## 4. Write and build

Write each post as the guide says, with its slot's `date:` from the schedule and a short, new file name in `posts/`.
Find each post a photo on Wikimedia Commons as the guide's "Photos" section explains: search with WebFetch, download
with `node tools/commons-photo.mjs`. Then run `node tools/build-blog.mjs` (no
flags) and make sure it finishes without errors: it checks every post, including scheduled ones, and stops on em or
en dashes and on photos missing their alt text or credit. Scheduled posts are left out of the built pages until their
time, so expect "4 scheduled for later".

## 5. Hand the posts over

Commit only the new posts, their photos and what the build changed (`posts/`, `media/blog/`, `blog/`, `sitemap.xml`,
`robots.txt`, `index.html`), with the message `Blog posts for YYYY-MM-DD`. Don't add any co-author, "generated with"
or similar attribution lines to the commit or the pull request.

- **Review: pull request.** Commit on a new branch named `blog/YYYY-MM-DD`, push it and open a pull request into
  `main` titled `Blog posts for <date>`. In its description, list each post with its go-live time, title, sources
  and anything you weren't sure about. Don't merge it: merging is the approval.
- **Review: none.** Commit straight onto `main` and push. The posts go live at their slots. If pushing to `main` is
  refused, push the branch `blog/YYYY-MM-DD` instead, open a pull request into `main` titled `Blog posts for <date>`
  and merge it; if merging is refused too, leave the pull request open and say so in your final message.

Never change any other file. If the build fails, or posts for today already exist, stop and say why in your final
message.
