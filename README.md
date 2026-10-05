# eliteeducationuae.github.io
Elite Education UAE website — powered by GitHub Pages

The Elite Education tutoring app (iOS, Android, web) lives in [`app/`](app/README.md). The web version is published at `/app/` by `.github/workflows/deploy.yml`.

## Session plans and handover packs

- **Session plans.** Tutors can plan any scheduled lesson: objectives, syllabus topics, resources and homework to set. A plan stays private to the tutor and admins unless the tutor chooses to share it with the family. In a group lesson, each family sees only general planned homework and homework for their own children. When the lesson is recorded, the plan pre-fills Record lesson.
- **Handover packs.** A pack is created automatically whenever a student changes tutor: a lesson is covered, an enrolment's tutor changes, or a role with a named student is awarded. It brings together the student's goals and tutor notes, recent lesson notes, open homework, lesson plans, topic ratings, resources and latest report. Repeat changes for the same student, tutor and subject within 14 days share one pack.
- **Who sees what.** Only the incoming tutor and admins can open a pack. The outgoing tutor is notified and asked to add a short handover note, which is passed on to the incoming tutor. Private lesson notes remain visible only to the tutor who taught that lesson and to admins.
- **Database.** `app/supabase/migrations/20261110000000_handover.sql` (tables `lesson_plans` and `handovers`; tested in `app/supabase/tests/handover_test.sql`).
