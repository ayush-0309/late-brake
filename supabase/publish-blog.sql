-- Puts scheduled blog posts live on time. GitHub starts the publish-blog
-- workflow's own scheduled runs hours late or skips them, so Supabase's cron
-- (pg_cron) asks GitHub to run it instead (pg_net), a minute after every
-- quarter hour through the Indian day: 08:31, 08:46 … 19:16. A post set for
-- 09:00 goes up at 09:01 and is on the site a minute or two later. See
-- "Publishing blog posts on time" in README.md here.
--
-- Run it in the SQL Editor after saving the GitHub token in the Vault as
-- github_publish_token. Running it again replaces the job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'publish-blog',
  '1,16,31,46 3-13 * * *', -- UTC, which is India time minus 5:30
  $$
  select net.http_post(
    url := 'https://api.github.com/repos/ayush-0309/late-brake/actions/workflows/publish-blog.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_publish_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'late-brake-publish-blog'
    ),
    body := '{"ref": "main"}'::jsonb
  );
  $$
);
