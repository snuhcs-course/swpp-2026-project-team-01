# Database tests

pgTAP tests for grants, row-level security, triggers and concurrency live in this directory. They run against a fresh local stack:

```sh
supabase start
supabase test db
```
