# How Late Brake blog posts are written

This guide is for anyone writing a post, including the daily news routine, which reads it before every run.
Change it to change what gets written: it's the one place the blog's style lives.

## Who we're writing for

F1 fans, many of them in India, from casual race-day viewers to people who know every corner name. Most find us
through Google or a shared link. Give them something worth reading first; then, where it fits naturally, invite them
to drive the circuits themselves.

## What we write

Four kinds of post. Every day should have some news, plus one of the other three.

1. **News updates.** One story per post, plus a schedule post in race weeks (see `posts/_daily.md`): race, sprint and qualifying results, title fights, confirmed team and driver
   announcements, rule and calendar changes. 300 to 600 words.
2. **On this day.** Two or three things that happened in F1 on today's date in past years: wins, titles, debuts,
   famous moments. 300 to 500 words.
3. **History.** One story from the past told properly: a famous race, a forgotten team, a circuit that's gone, a rivalry.
   400 to 700 words. Stories with an Indian angle (Narain Karthikeyan, Karun Chandhok, Force India, the Indian Grand Prix)
   go down well with our readers.
4. **Fun facts.** A short list (5 to 7) of true facts that sound unlikely: strange races, records, firsts. Each fact gets a
   heading and two or three sentences. 300 to 500 words.

We don't write how-to guides for driving circuits or explain racing technique.

## How each kind is laid out

Every post has:

- **Title:** written like a news headline: says what happened, active and specific, under about 65 characters.
  "Antonelli wins US Grand Prix to move two points from the title", not "What a race in Austin!". "On this day"
  titles start `On this day:` and name the highlights. Fun-fact titles say how many facts there are.
- **Description:** the standfirst. One sentence, under about 155 characters, that sums up the whole story. It shows
  under the headline, in Google and in link previews.
- **A photo** (see "Photos" below), with a one-line caption.
- **## Race it on Late Brake:** one short paragraph at the end tying the post to the game. Use a circuit from the game
  if the post mentions one; if none does, say so plainly and point to the six real circuits that are in it. Mention a
  real feature: racing your own ghost, AI rivals, online races, the daily challenge, the racing line, the braking
  boards, the cockpit camera, medal times.
- **Sources:** end with a line like `Sources: [BBC Sport](https://…), [Wikipedia](https://…)` linking every source used.

Then, by kind:

- **News:** the first sentence is the news (who, what, where), the second gives the key detail or consequence. Then
  two or three `##` sections with plain headings ("Two points in Mexico", "What happens next"). Give race start times
  in India time too.
- **On this day:** a one-line intro, then one `## <year>: <what happened>` section per event, oldest first.
- **History:** a short intro that hooks the reader, then three or four `##` sections telling the story in order.
- **Fun facts:** a one-line intro, then `## 1. <the fact in a few words>` and so on.

The page adds a "Drive it on Late Brake" box at the end by itself: set `circuit:` in the front matter when the post
is about one of the game's circuits, so its button opens that circuit.

## Voice

Write like the top sports news sites (BBC Sport, Autosport, The Race): the news comes first, then the detail.

- Short paragraphs: one or two sentences each.
- Active voice and strong verbs: "Antonelli won", not "the race was won by Antonelli".
- Exact numbers, names and teams: "13.078 seconds clear of Ferrari's Charles Leclerc".
- Neutral and confident. No hype words ("incredible", "insane"), no emojis, no "in conclusion", no "buckle up".
- British spelling (colour, tyres, kilometres). Explain jargon the first time.
- **No em dashes (—) or en dashes (–).** Use a full stop, comma, colon or brackets instead, and "2011 to 2013" for
  ranges. The build stops if it finds one.

## Rules

- **Facts come from sources, and every source is linked.** News comes from the outlets in `posts/_daily.md`; history and
  fun facts from the championship's own site, the governing body or Wikipedia's race and driver pages. If sources disagree or something isn't
  confirmed, leave it out.
- **Never copy.** Write everything in your own words. At most one short quote per post, under 15 words, in quotation
  marks and credited.
- **No rumours about people.** No speculation about health, private lives or contracts that "sources say". Nothing
  that could be unfair or damaging to a named person.
- **Exact numbers:** results, gaps and lap times exactly as the source reports them, or not at all.
- **Photos only from Wikimedia Commons**, under CC BY, CC BY-SA, CC0 or public domain, and always credited (see
  below). Never photos from news sites, agencies, teams or the championship itself, never photos of TV screens, and never satellite
  or map images.
- **Say F1 and Formula 1 in posts, never about the game.** In the story, titles, descriptions, alt text and captions,
  use "F1", "Formula 1", team, sponsor and circuit names as the news does: they're what readers search for, and
  "F1" in a title helps. The game is different, because it's what earns money: the "Race it on Late Brake" section
  names circuits the way the game does (Spielberg, not the name on the gate) and never puts the championship's name
  beside Late Brake (not "race F1 circuits on Late Brake", but "six real circuits in Late Brake"). The game itself,
  its pages and the circuit pages in `content/circuits/` never use these names, and the build stops if they do.
- **Never suggest Late Brake is official or endorsed** by any series, team or circuit.

## Photos

Every post should have one photo from [Wikimedia Commons](https://commons.wikimedia.org). Search it for the driver,
race or circuit (for example "Kimi Antonelli 2026" or "Buddh International Circuit"), and prefer a recent, sharp,
landscape photo of the car or place the post is about. Check the file's licence on its Commons page: CC BY, CC BY-SA,
CC0 or public domain only.

**How to find and download it.** Commons' API is often rate-limited from the cloud (HTTP 429), so:

1. **Search** with the WebFetch tool on this API address, asking for each result's file title, width, licence
   (`LicenseShortName`) and author (`Artist`), copied exactly:

   ```
   https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8
     &gsrsearch=<words>&prop=imageinfo&iiprop=size|extmetadata
   ```

   Pick a JPEG at least 1280 pixels wide with an allowed licence.
2. **Download** it with the repo's tool, which works out Commons' 1280px thumbnail address from the file title and
   retries if Commons is busy:

   ```
   node tools/commons-photo.mjs "File:<exact title>.jpg" media/blog/<post file name>.jpg
   ```

   If it fails, try another photo; if none works, publish the post without one.

Then add to the front matter (the credit links to the photo's Commons page, `https://commons.wikimedia.org/wiki/File:…`
with spaces as underscores):

```
image: antonelli-wins-austin-title-in-mexico.jpg
alt: What the photo shows, for people who can't see it.
caption: One line saying what, where and when, like a newspaper caption.
credit: [Author](https://commons.wikimedia.org/wiki/File:…), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0), via Wikimedia Commons
```

The caption must be true of the photo itself: if it's from a different race or year than the story, say which.
If no suitable free photo exists, leave the photo out rather than use one that doesn't fit.

## The game's circuits

| `circuit:` | Circuit | Country | Bronze | Silver | Gold |
|---|---|---|---|---|---|
| `at-1969` | Spielberg | Austria | 1:19 | 1:14.5 | 1:11.5 |
| `it-1922` | Monza | Italy | 1:36.5 | 1:30 | 1:26.5 |
| `gb-1948` | Silverstone | Great Britain | 1:54 | 1:46 | 1:40.5 |
| `be-1925` | Spa-Francorchamps | Belgium | 2:07.5 | 1:58 | 1:55 |
| `mc-1929` | Monaco | Monaco | 1:25.5 | 1:21 | 1:18 |
| `br-1940` | Interlagos | Brazil | 1:27 | 1:20.5 | 1:17 |

Medal times are for the game's car and aren't comparable with real lap times; don't put them side by side.

## Files

One file per post in `posts/`, named with a short slug: `posts/antonelli-wins-austin-title-in-mexico.md` becomes
`latebrake.in/blog/antonelli-wins-austin-title-in-mexico.html`. Never reuse a name. It starts with front matter:

```
---
title: Antonelli wins US Grand Prix to move two points from the title
description: One sentence for under the headline, Google and link previews.
date: 2026-10-29 09:00
kind: news
circuit: br-1940
---
```

`date` is when the post goes live, in India time; the daily posts use the slots in `posts/_daily.md`.
`kind` is `news`, `on-this-day`, `history` or `facts`: it labels the post.
`circuit` is optional, and so is the photo (see "Photos"). Then write the post in Markdown: `##` headings, paragraphs, `-` lists, `>` quotes, `**bold**`,
`*italic*` and `[links](https://…)`. Run `node tools/build-blog.mjs` afterwards to build the pages.
