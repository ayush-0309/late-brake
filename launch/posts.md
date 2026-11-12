# Launch posts: Hacker News and Reddit

Post these yourself, from your own accounts, a day or two apart rather than all at once, so you can answer every
comment. Read each community's rules (the sidebar on Reddit) before posting: they change, and a removed post can't
be put back. Reply to people as yourself, thank them for bug reports, and fix what they find.

The links in these posts mostly don't raise the domain rating themselves. Their job is players and attention: the
people who write about the game afterwards are the links that count.

No trademarked championship names here either (F1, Formula 1, Red Bull Ring); "Grand Prix racing" is fine. No em
or en dashes, which is the site's house style.

## Hacker News: Show HN

Post on a weekday morning in the US (about 6:30 to 8:30 pm in India). Submit at news.ycombinator.com/submit:

- **Title:** `Show HN: Late Brake, a browser racing game on six real circuits`
- **URL:** `https://www.latebrake.in/play.html`

Then add this as the first comment straight away:

> Hi HN, I'm Ayush. Late Brake is a top-down racing game on six real circuits (Monza, Spa, Silverstone, Monaco,
> Interlagos and Spielberg), drawn from the real tracks' outlines at full scale. Time trials need no account, so
> you can be on track in a couple of clicks.
>
> Some things that were fun to build:
>
> - It's plain JavaScript with no framework, engine or build step. The top-down views are Canvas 2D and the
>   cockpit camera is a small WebGL renderer built from the same track data.
> - Physics runs at a fixed 60 Hz, so a lap replays exactly from its inputs. Ghosts depend on that, and so do the
>   medal times: a script drives an AI around each circuit headless and its best clean laps become bronze, silver
>   and gold.
> - The racing line is a minimum-curvature line with a speed profile worked out from the circuit's shape and the
>   car's grip, which also places the braking boards.
> - Track limits follow Grand Prix rules: all four wheels past the white line deletes the lap, and in races each
>   trip off is a strike, with a warning flag on the third and five-second penalties after that. Making the AI
>   obey them took traction control and a guard that brakes when a slide heads for the edge.
> - Online races use Supabase Realtime. Each car sends its state ten times a second and the others are
>   extrapolated and eased between updates.
> - The engine sound is a real race car recording looped and pitched with rpm through Web Audio; the tyres,
>   kerbs and impacts are synthesized.
>
> I'd like feedback on the handling, especially on a keyboard, and on the touch controls if you try it on a phone.

## r/WebGames

A link post, straight to the game.

- **Title:** `Late Brake: a top-down racing game on six real circuits, free, no download, no account needed`
- **Link:** `https://www.latebrake.in/play.html`

Then comment:

> I made this. Time trials against your own ghost, races against AI at three levels, and online races for up to
> four players. Every circuit has bronze, silver and gold times to beat. Arrow keys or WASD, a gamepad, or the
> on-screen pedals on a phone. Happy to hear what feels off.

## r/IndieGaming

Clips do far better than links here. Record 20 to 30 seconds of a lap (Monaco in the chase camera, or any circuit in the
cockpit camera) and post it as a video.

- **Title:** `I'm a solo dev and I built a racing game on six real circuits that runs in the browser`

First comment:

> It's called Late Brake and it's free at https://www.latebrake.in/ (no download, and time trials need no account). The
> circuits are the real ones at true scale: Monza, Spa, Silverstone, Monaco, Interlagos and Spielberg. There are
> time trials with ghosts, AI races, online races for up to four, and medals on every circuit. Track limits are
> strict, like the real thing: all four wheels over the line and the lap is deleted.
>
> I'd love feedback on the handling and which circuit to add next.

## r/playmygame

This one wants a set format. Text post:

- **Title:** `Late Brake: a racing game on six real circuits, playable in the browser`

Body:

> **Game Title:** Late Brake
>
> **Playable Link:** https://www.latebrake.in/play.html
>
> **Platform:** Web (computer, phone or tablet)
>
> **Description:** A top-down racing game on six real circuits at true scale. Set laps in time trial against your
> own ghost, race AI drivers at three difficulty levels, or race up to three friends online. Each circuit has
> bronze, silver and gold medal times and a leaderboard, and there's a daily challenge. Controls: arrow keys or
> WASD, a gamepad, or on-screen pedals on touch screens.
>
> **Free to Play Status:** Free to play
>
> **Involvement:** I'm the only developer. I built the game, the physics, the AI and the website.

## r/developersIndia

Pick the flair for showing off a project (it's been called "I Made This"). Text post:

- **Title:** `I built a browser racing game with online multiplayer as a solo dev, here's how it works`

Body:

> I've been building Late Brake, a top-down racing game on six real circuits that runs in the browser:
> https://www.latebrake.in/
>
> The stack is deliberately small:
>
> - Plain JavaScript, no framework or bundler. Canvas 2D for the top-down views and a small WebGL renderer for
>   the cockpit camera.
> - Fixed 60 Hz physics so laps are deterministic. Ghost laps are just recorded positions, and the medal times
>   come from running the AI headless in Node.
> - Supabase for Google sign-in, leaderboards and the daily challenge, and Supabase Realtime for
>   online races of up to four.
> - Vercel for hosting, with a GitHub Action that publishes the blog's scheduled posts.
> - Dodo Payments for the only thing on sale, cosmetic car colours, priced per country (₹59 to ₹299 in India).
>
> The hardest part was the AI. Once I made the track limits strict (all four wheels over the line deletes the
> lap) I found the AI had been cutting chicanes at Monza and Spa, so it got traction control and an edge guard
> that brakes when a slide heads for the grass.
>
> Happy to answer questions about any of it, and I'd like feedback from anyone who plays it.

Before posting this one, check the prices in the post still match the Garage.
