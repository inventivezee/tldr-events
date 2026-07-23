-- Industry-relevance flag on scores. Drives the TLDR (relevant) vs All-Events
-- (everything) split, independent of the numeric quality score.
alter table scores add column if not exists relevant boolean default true;
create index if not exists scores_feed_relevant_idx on scores (feed_id, relevant);
