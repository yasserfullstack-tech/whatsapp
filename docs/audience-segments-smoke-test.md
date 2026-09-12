# Audience smoke test

After `bun run db:push`, validate this milestone with a small non-production workspace:

1. Import a CSV with a list name and confirm both new and pre-existing contacts appear in `contact_list_members`.
2. Create a segment using a list filter plus a name or phone filter; compare the preview count/sample with a direct database query.
3. Send a STOP webhook for one contact and confirm the segment/list campaign count excludes that contact even though list membership remains.
4. Launch a campaign to the list/segment and confirm `campaign_audiences.definition` stores the selected definition.
5. Edit/re-save the source segment and confirm an already-launched campaign keeps its original `campaign_recipients` snapshot.
6. Pause/cancel a selected-audience campaign and confirm existing queue-control semantics remain unchanged.
