-- patch-014: more ready WhatsApp messages for every company. Safe to run again (skips any message name you already have).
insert into public.templates (org_id, use_for, name, body)
select o.id, t.use_for, t.name, t.body
from public.organizations o
cross join (values
  ('Welcome', 'New enquiry: quick hello',
   E'Hi {{name}}, thank you for your enquiry about {{project}}. I''m {{agent}} from {{company}}.\n\nCan I call you in the next 10 minutes? Or tell me a time that suits you.'),
  ('Follow-up', 'Missed call: did not pick up',
   E'Hi {{name}}, I just called you about your {{bhk}} search in {{location}}. I will try again later, or you can call me any time on {{agent_phone}}.\n– {{agent}}, {{company}}'),
  ('Follow-up', 'Options in their budget',
   E'Hi {{name}}, I have found a few good {{bhk}} options in {{location}} within {{budget}}.\n\nShall I send the photos and prices here?'),
  ('Follow-up', 'Still looking? (old lead)',
   E'Hi {{name}}, {{agent}} from {{company}} here. Are you still looking for a home?\n\nSome new projects have come up in {{location}}. Happy to send you a few options.'),
  ('Follow-up', 'Last try (polite)',
   E'Hi {{name}}, I tried to reach you a few times. If you have already found a home, just reply "done" and I will not disturb you.\n\nIf you are still looking, I am here to help. – {{agent}}'),
  ('Visit reminder', 'Visit booked: confirmation',
   E'Hi {{name}}, your site visit to {{project}} is confirmed for {{visit_time}}.\n\nI will send the location pin. If anything changes, call me: {{agent_phone}}\n– {{agent}}, {{company}}'),
  ('Visit reminder', 'Visit day: good morning',
   E'Good morning {{name}}! See you today at {{project}} ({{visit_time}}).\n\nI will be at the site to show you around. Location pin coming next.'),
  ('After visit', 'Thanks for visiting',
   E'Hi {{name}}, thank you for visiting {{project}} today. How did you like it?\n\nAny question about the price, floor plan or home loan, just ask me here.'),
  ('After visit', 'Second visit with family',
   E'Hi {{name}}, many buyers like to bring their family for a second look before deciding.\n\nShall I book a visit to {{project}} this weekend? Saturday or Sunday?'),
  ('Price / offer', 'Price list and floor plans',
   E'Hi {{name}}, as promised, I am sharing the price list and floor plans of {{project}}.\n\nTell me which unit you like and I will check if it is still available.'),
  ('Price / offer', 'This month''s offer',
   E'Hi {{name}}, {{project}} has an offer this month: [write the offer here].\n\nIt is open till [date]. Shall I hold a unit for you?'),
  ('Price / offer', 'Home loan help',
   E'Hi {{name}}, we can help you with the home loan for {{project}}.\n\nShare your rough monthly income and I will get you an EMI estimate from the banks. No charge for this.'),
  ('Other', 'Booking: congratulations',
   E'Congratulations {{name}}! Welcome to the {{project}} family.\n\nThank you for trusting {{company}}. I will share the next steps and the payment schedule shortly.\n– {{agent}}'),
  ('Other', 'Ask for a referral',
   E'Hi {{name}}, I hope you are happy with your home at {{project}}!\n\nIf any friend or family member is looking for a home, please share my number {{agent_phone}}. We will take good care of them.'),
  ('Birthday', 'Birthday wishes',
   E'Happy birthday {{name}}! Wishing you and your family a wonderful year ahead.\n– {{agent}}, {{company}}'),
  ('Follow-up', 'Hindi: follow-up call',
   E'Namaste {{name}} ji, main {{agent}}, {{company}} se baat kar raha hoon. Aapne {{location}} mein {{bhk}} ke liye poocha tha.\n\nKya abhi 5 minute baat ho sakti hai?'),
  ('Visit reminder', 'Hindi: visit reminder',
   E'Namaste {{name}} ji, {{project}} ki site visit {{visit_time}} ko hai.\n\nKoi badlav ho to call karein: {{agent_phone}}\n– {{agent}}, {{company}}')
) as t(use_for, name, body)
where not exists (select 1 from public.templates x where x.org_id = o.id and x.name = t.name);

select 'patch-014 done';
