-- Run once in the Supabase SQL editor after creating your own login in
-- Authentication → Users. Replace the email below with the one you signed up with.
-- It makes you the admin and creates your tutor profile.

with t as (
  insert into public.tutors (full_name, email, hourly_pay, subjects, color)
  values ('Craig O''Brien', 'craig@craigobrieneducation.com', 0, '{IB,IGCSE,A-Level}', '#2b6cb0')
  returning id
)
insert into public.profiles (id, role, full_name, email, tutor_id)
select u.id, 'admin', 'Craig O''Brien', u.email, t.id
from auth.users u, t
where u.email = 'craig@craigobrieneducation.com';

-- Starter services (edit prices in the app under More → Services & rates).
insert into public.services (name, duration_min, rate) values
  ('IB Maths 1:1', 60, 450),
  ('IGCSE Maths 1:1', 60, 350),
  ('A-Level Maths 1:1', 90, 550),
  ('IGCSE Small Group', 90, 250);

-- To give a tutor, parent or student a login: invite them in Authentication → Users, then e.g.
-- insert into public.profiles (id, role, full_name, email, family_id)
-- select id, 'parent', 'Fatima Al Mansoori', email, '<family id from the families table>'
-- from auth.users where email = 'fatima@example.com';
