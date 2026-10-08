-- Sumeet Urban Nest (Sumeet Group) → TrustArc Estates: the project, its rate card, payment plan, terms and all 140 flats.
-- Run AFTER patch-018-units.sql. Safe to run again: it updates the project and reloads the flats (statuses come from the inventory sheet).
do $$
declare v_org uuid; v_p uuid;
begin
  select id into v_org from public.organizations where name ilike '%trustarc%' order by created_at limit 1;
  if v_org is null then raise exception 'Company "TrustArc Estates" not found. Rename the company on the Team page first.'; end if;

  select id into v_p from public.projects where org_id = v_org and name = 'Sumeet Urban Nest';
  if v_p is null then
    insert into public.projects (org_id, name) values (v_org, 'Sumeet Urban Nest') returning id into v_p;
  end if;

  update public.projects set
    developer = 'Sumeet Group (Sumeet Infracon Pvt. Ltd.)',
    location = 'Shankar Nagar – Khamardih, Raipur',
    rera_no = 'PCGRERA190326002064',
    type = 'Apartment',
    configs = '2, 3 BHK',
    status = coalesce(status, 'Under construction'),
    highlights = 'Premium 2 & 3 BHK homes with spacious layouts. Easy reach to VIP Road, GE Road, the airport and the railway station.',
    towers = '3 towers (G+9)',
    amenities = 'Rooftop lifestyle zone, Swimming pool, Gymnasium, Indoor games, Mini theatre, Multipurpose hall, Club membership, Car parking',
    lat = 21.255678, lng = 81.674252,
    map_url = 'https://maps.app.goo.gl/UNhEhePZZt1ZiAfw5',
    rate_card = '[{"floors":"1–3","rate":4700},{"floors":"4–6","rate":4800},{"floors":"7–9","rate":4900}]'::jsonb,
    payment_plan = 'Construction Link Plan (10 equal parts of 10%):
1. Booking 10%
2. Start of work 10%
3. Plinth floor slab 10%
4. Third floor slab 10%
5. Fifth floor slab 10%
6. Seventh floor slab 10%
7. Ninth floor slab 10%
8. Unit brick work 10%
9. Flooring work 10%
10. Offer of possession 10%',
    terms = 'Booking: fill the registration form and pay 10% of the total deal value.
Payment by cheque / RTGS to "Sumeet Infracon Pvt. Ltd." only. Third-party payments are not accepted.
Each instalment is due within 7 days of its stage. Late payment: SBI''s highest MCLR + 2% a year as interest.
If an instalment (with interest) is not paid for 2 months in a row, the booking can be cancelled. Refund after the unit is resold, minus 5% of the deal value as cancellation charge + GST on the amount received, and ₹20,000 documentation charges.
GST on the unit price and registry charges are extra (as per government rules), paid by the buyer.
Paid at registry: common area maintenance for 3 years (from first offer of possession or registry, whichever is earlier), society formation, sinking fund.
Included: one car parking for 2 BHK or 3 BHK; club membership for families living in the campus.
Electricity load: 2 BHK 4 KW, 3 BHK 6 KW.'
  where id = v_p;

  delete from public.project_units where project_id = v_p;
  insert into public.project_units (org_id, project_id, tower, floor, unit_no, bhk, sba, carpet, rate, status) values
    (v_org, v_p, 'A', 1, 'A-101', '3 BHK', 2007.49, 1342.5, 4700, 'open'),
    (v_org, v_p, 'A', 1, 'A-102', '3 BHK', 1982.19, 1353.3, 4700, 'booked'),
    (v_org, v_p, 'A', 1, 'A-103', '3 BHK', 1983.16, 1378.8, 4700, 'mortgage'),
    (v_org, v_p, 'A', 1, 'A-104', '3 BHK', 1966.37, 1351.6, 4700, 'booked'),
    (v_org, v_p, 'A', 1, 'A-105', '3 BHK', 1940.0, 1344.1, 4700, 'open'),
    (v_org, v_p, 'A', 1, 'A-106', '3 BHK', 1953.67, 1344.1, 4700, 'open'),
    (v_org, v_p, 'A', 2, 'A-201', '3 BHK', 2007.49, 1342.5, 4700, 'booked'),
    (v_org, v_p, 'A', 2, 'A-202', '3 BHK', 1982.19, 1353.3, 4700, 'booked'),
    (v_org, v_p, 'A', 2, 'A-203', '3 BHK', 1983.16, 1378.8, 4700, 'mortgage'),
    (v_org, v_p, 'A', 2, 'A-204', '3 BHK', 1966.37, 1351.6, 4700, 'booked'),
    (v_org, v_p, 'A', 2, 'A-205', '3 BHK', 1940.0, 1344.1, 4700, 'open'),
    (v_org, v_p, 'A', 2, 'A-206', '3 BHK', 1953.67, 1344.1, 4700, 'open'),
    (v_org, v_p, 'A', 3, 'A-301', '3 BHK', 2007.49, 1342.5, 4700, 'open'),
    (v_org, v_p, 'A', 3, 'A-302', '3 BHK', 1982.19, 1353.3, 4700, 'open'),
    (v_org, v_p, 'A', 3, 'A-303', '3 BHK', 1983.16, 1378.8, 4700, 'mortgage'),
    (v_org, v_p, 'A', 3, 'A-304', '3 BHK', 1966.37, 1351.6, 4700, 'booked'),
    (v_org, v_p, 'A', 3, 'A-305', '3 BHK', 1940.0, 1344.1, 4700, 'open'),
    (v_org, v_p, 'A', 3, 'A-306', '3 BHK', 1953.67, 1344.1, 4700, 'open'),
    (v_org, v_p, 'A', 4, 'A-401', '3 BHK', 2007.49, 1342.5, 4800, 'open'),
    (v_org, v_p, 'A', 4, 'A-402', '3 BHK', 1982.19, 1353.3, 4800, 'open'),
    (v_org, v_p, 'A', 4, 'A-403', '3 BHK', 1983.16, 1378.8, 4800, 'mortgage'),
    (v_org, v_p, 'A', 4, 'A-404', '3 BHK', 1966.37, 1351.6, 4800, 'open'),
    (v_org, v_p, 'A', 4, 'A-405', '3 BHK', 1940.0, 1344.1, 4800, 'open'),
    (v_org, v_p, 'A', 4, 'A-406', '3 BHK', 1953.67, 1344.1, 4800, 'open'),
    (v_org, v_p, 'A', 5, 'A-501', '3 BHK', 2007.49, 1342.5, 4800, 'open'),
    (v_org, v_p, 'A', 5, 'A-502', '3 BHK', 1982.19, 1353.3, 4800, 'booked'),
    (v_org, v_p, 'A', 5, 'A-503', '3 BHK', 1983.16, 1378.8, 4800, 'mortgage'),
    (v_org, v_p, 'A', 5, 'A-504', '3 BHK', 1966.37, 1351.6, 4800, 'open'),
    (v_org, v_p, 'A', 5, 'A-505', '3 BHK', 1940.0, 1344.1, 4800, 'open'),
    (v_org, v_p, 'A', 5, 'A-506', '3 BHK', 1953.67, 1344.1, 4800, 'open'),
    (v_org, v_p, 'A', 6, 'A-601', '3 BHK', 2007.49, 1342.5, 4800, 'booked'),
    (v_org, v_p, 'A', 6, 'A-602', '3 BHK', 1982.19, 1353.3, 4800, 'open'),
    (v_org, v_p, 'A', 6, 'A-603', '3 BHK', 1983.16, 1378.8, 4800, 'open'),
    (v_org, v_p, 'A', 6, 'A-604', '3 BHK', 1966.37, 1351.6, 4800, 'open'),
    (v_org, v_p, 'A', 6, 'A-605', '3 BHK', 1940.0, 1344.1, 4800, 'open'),
    (v_org, v_p, 'A', 6, 'A-606', '3 BHK', 1953.67, 1344.1, 4800, 'open'),
    (v_org, v_p, 'A', 7, 'A-701', '3 BHK', 2007.49, 1342.5, 4900, 'open'),
    (v_org, v_p, 'A', 7, 'A-702', '3 BHK', 1982.19, 1353.3, 4900, 'open'),
    (v_org, v_p, 'A', 7, 'A-703', '3 BHK', 1983.16, 1378.8, 4900, 'open'),
    (v_org, v_p, 'A', 7, 'A-704', '3 BHK', 1966.37, 1351.6, 4900, 'open'),
    (v_org, v_p, 'A', 7, 'A-705', '3 BHK', 1940.0, 1344.1, 4900, 'open'),
    (v_org, v_p, 'A', 7, 'A-706', '3 BHK', 1953.67, 1344.1, 4900, 'open'),
    (v_org, v_p, 'A', 8, 'A-801', '3 BHK', 2007.49, 1342.5, 4900, 'open'),
    (v_org, v_p, 'A', 8, 'A-802', '3 BHK', 1982.19, 1353.3, 4900, 'booked'),
    (v_org, v_p, 'A', 8, 'A-803', '3 BHK', 1983.16, 1378.8, 4900, 'open'),
    (v_org, v_p, 'A', 8, 'A-804', '3 BHK', 1966.37, 1351.6, 4900, 'open'),
    (v_org, v_p, 'A', 8, 'A-805', '3 BHK', 1940.0, 1344.1, 4900, 'open'),
    (v_org, v_p, 'A', 8, 'A-806', '3 BHK', 1953.67, 1344.1, 4900, 'booked'),
    (v_org, v_p, 'A', 9, 'A-901', '3 BHK', 2007.49, 1342.5, 4900, 'open'),
    (v_org, v_p, 'A', 9, 'A-902', '3 BHK', 1982.19, 1353.3, 4900, 'open'),
    (v_org, v_p, 'A', 9, 'A-903', '3 BHK', 1983.16, 1378.8, 4900, 'open'),
    (v_org, v_p, 'A', 9, 'A-904', '3 BHK', 1966.37, 1351.6, 4900, 'open'),
    (v_org, v_p, 'A', 9, 'A-905', '3 BHK', 1940.0, 1344.1, 4900, 'open'),
    (v_org, v_p, 'A', 9, 'A-906', '3 BHK', 1953.67, 1344.1, 4900, 'open'),
    (v_org, v_p, 'B', 1, 'B-101', '3 BHK', 1982.19, 1353.3, 4700, 'open'),
    (v_org, v_p, 'B', 1, 'B-102', '3 BHK', 1950.11, 1344.1, 4700, 'open'),
    (v_org, v_p, 'B', 1, 'B-103', '3 BHK', 1934.94, 1316.9, 4700, 'mortgage'),
    (v_org, v_p, 'B', 1, 'B-104', '3 BHK', 1976.7, 1378.8, 4700, 'open'),
    (v_org, v_p, 'B', 1, 'B-105', '3 BHK', 1986.71, 1378.8, 4700, 'booked'),
    (v_org, v_p, 'B', 1, 'B-106', '3 BHK', 2007.49, 1342.5, 4700, 'open'),
    (v_org, v_p, 'B', 2, 'B-201', '3 BHK', 1982.19, 1353.3, 4700, 'booked'),
    (v_org, v_p, 'B', 2, 'B-202', '3 BHK', 1950.11, 1344.1, 4700, 'open'),
    (v_org, v_p, 'B', 2, 'B-203', '3 BHK', 1934.94, 1316.9, 4700, 'mortgage'),
    (v_org, v_p, 'B', 2, 'B-204', '3 BHK', 1976.7, 1378.8, 4700, 'open'),
    (v_org, v_p, 'B', 2, 'B-205', '3 BHK', 1986.71, 1378.8, 4700, 'open'),
    (v_org, v_p, 'B', 2, 'B-206', '3 BHK', 2007.49, 1342.5, 4700, 'booked'),
    (v_org, v_p, 'B', 3, 'B-301', '3 BHK', 1982.19, 1353.3, 4700, 'booked'),
    (v_org, v_p, 'B', 3, 'B-302', '3 BHK', 1950.11, 1344.1, 4700, 'open'),
    (v_org, v_p, 'B', 3, 'B-303', '3 BHK', 1934.94, 1316.9, 4700, 'mortgage'),
    (v_org, v_p, 'B', 3, 'B-304', '3 BHK', 1976.7, 1378.8, 4700, 'open'),
    (v_org, v_p, 'B', 3, 'B-305', '3 BHK', 1986.71, 1378.8, 4700, 'booked'),
    (v_org, v_p, 'B', 3, 'B-306', '3 BHK', 2007.49, 1342.5, 4700, 'booked'),
    (v_org, v_p, 'B', 4, 'B-401', '3 BHK', 1982.19, 1353.3, 4800, 'open'),
    (v_org, v_p, 'B', 4, 'B-402', '3 BHK', 1950.11, 1344.1, 4800, 'open'),
    (v_org, v_p, 'B', 4, 'B-403', '3 BHK', 1934.94, 1316.9, 4800, 'mortgage'),
    (v_org, v_p, 'B', 4, 'B-404', '3 BHK', 1976.7, 1378.8, 4800, 'open'),
    (v_org, v_p, 'B', 4, 'B-405', '3 BHK', 1986.71, 1378.8, 4800, 'open'),
    (v_org, v_p, 'B', 4, 'B-406', '3 BHK', 2007.49, 1342.5, 4800, 'open'),
    (v_org, v_p, 'B', 5, 'B-501', '3 BHK', 1982.19, 1353.3, 4800, 'open'),
    (v_org, v_p, 'B', 5, 'B-502', '3 BHK', 1950.11, 1344.1, 4800, 'open'),
    (v_org, v_p, 'B', 5, 'B-503', '3 BHK', 1934.94, 1316.9, 4800, 'open'),
    (v_org, v_p, 'B', 5, 'B-504', '3 BHK', 1976.7, 1378.8, 4800, 'open'),
    (v_org, v_p, 'B', 5, 'B-505', '3 BHK', 1986.71, 1378.8, 4800, 'open'),
    (v_org, v_p, 'B', 5, 'B-506', '3 BHK', 2007.49, 1342.5, 4800, 'open'),
    (v_org, v_p, 'B', 6, 'B-601', '3 BHK', 1982.19, 1353.3, 4800, 'booked'),
    (v_org, v_p, 'B', 6, 'B-602', '3 BHK', 1950.11, 1344.1, 4800, 'open'),
    (v_org, v_p, 'B', 6, 'B-603', '3 BHK', 1934.94, 1316.9, 4800, 'open'),
    (v_org, v_p, 'B', 6, 'B-604', '3 BHK', 1976.7, 1378.8, 4800, 'open'),
    (v_org, v_p, 'B', 6, 'B-605', '3 BHK', 1986.71, 1378.8, 4800, 'open'),
    (v_org, v_p, 'B', 6, 'B-606', '3 BHK', 2007.49, 1342.5, 4800, 'booked'),
    (v_org, v_p, 'B', 7, 'B-701', '3 BHK', 1982.19, 1353.3, 4900, 'open'),
    (v_org, v_p, 'B', 7, 'B-702', '3 BHK', 1950.11, 1344.1, 4900, 'open'),
    (v_org, v_p, 'B', 7, 'B-703', '3 BHK', 1934.94, 1316.9, 4900, 'open'),
    (v_org, v_p, 'B', 7, 'B-704', '3 BHK', 1976.7, 1378.8, 4900, 'open'),
    (v_org, v_p, 'B', 7, 'B-705', '3 BHK', 1986.71, 1378.8, 4900, 'open'),
    (v_org, v_p, 'B', 7, 'B-706', '3 BHK', 2007.49, 1342.5, 4900, 'open'),
    (v_org, v_p, 'B', 8, 'B-801', '3 BHK', 1982.19, 1353.3, 4900, 'open'),
    (v_org, v_p, 'B', 8, 'B-802', '3 BHK', 1950.11, 1344.1, 4900, 'open'),
    (v_org, v_p, 'B', 8, 'B-803', '3 BHK', 1934.94, 1316.9, 4900, 'open'),
    (v_org, v_p, 'B', 8, 'B-804', '3 BHK', 1976.7, 1378.8, 4900, 'open'),
    (v_org, v_p, 'B', 8, 'B-805', '3 BHK', 1986.71, 1378.8, 4900, 'open'),
    (v_org, v_p, 'B', 8, 'B-806', '3 BHK', 2007.49, 1342.5, 4900, 'open'),
    (v_org, v_p, 'B', 9, 'B-901', '3 BHK', 1982.19, 1353.3, 4900, 'open'),
    (v_org, v_p, 'B', 9, 'B-902', '3 BHK', 1950.11, 1344.1, 4900, 'open'),
    (v_org, v_p, 'B', 9, 'B-903', '3 BHK', 1934.94, 1316.9, 4900, 'open'),
    (v_org, v_p, 'B', 9, 'B-904', '3 BHK', 1976.7, 1378.8, 4900, 'open'),
    (v_org, v_p, 'B', 9, 'B-905', '3 BHK', 1986.71, 1378.8, 4900, 'open'),
    (v_org, v_p, 'B', 9, 'B-906', '3 BHK', 2007.49, 1342.5, 4900, 'open'),
    (v_org, v_p, 'C', 1, 'C-101', '2 BHK', 1209.23, 728.2, 4700, 'booked'),
    (v_org, v_p, 'C', 1, 'C-102', '2 BHK', 1306.32, 746.0, 4700, 'booked'),
    (v_org, v_p, 'C', 2, 'C-201', '2 BHK', 1209.23, 728.2, 4700, 'booked'),
    (v_org, v_p, 'C', 2, 'C-202', '2 BHK', 1306.32, 746.0, 4700, 'booked'),
    (v_org, v_p, 'C', 3, 'C-301', '2 BHK', 1209.23, 728.2, 4700, 'booked'),
    (v_org, v_p, 'C', 3, 'C-302', '2 BHK', 1306.32, 746.0, 4700, 'booked'),
    (v_org, v_p, 'C', 3, 'C-303', '3 BHK', 1757.01, 1100.4, 4700, 'open'),
    (v_org, v_p, 'C', 3, 'C-304', '3 BHK', 1791.56, 1116.0, 4700, 'open'),
    (v_org, v_p, 'C', 4, 'C-401', '2 BHK', 1209.23, 728.2, 4800, 'booked'),
    (v_org, v_p, 'C', 4, 'C-402', '2 BHK', 1306.32, 746.0, 4800, 'booked'),
    (v_org, v_p, 'C', 4, 'C-403', '3 BHK', 1757.01, 1100.4, 4800, 'open'),
    (v_org, v_p, 'C', 4, 'C-404', '3 BHK', 1791.56, 1116.0, 4800, 'open'),
    (v_org, v_p, 'C', 5, 'C-501', '2 BHK', 1209.23, 728.2, 4800, 'mortgage'),
    (v_org, v_p, 'C', 5, 'C-502', '2 BHK', 1306.32, 746.0, 4800, 'booked'),
    (v_org, v_p, 'C', 5, 'C-503', '3 BHK', 1757.01, 1100.4, 4800, 'booked'),
    (v_org, v_p, 'C', 5, 'C-504', '3 BHK', 1791.56, 1116.0, 4800, 'booked'),
    (v_org, v_p, 'C', 6, 'C-601', '2 BHK', 1209.23, 728.2, 4800, 'open'),
    (v_org, v_p, 'C', 6, 'C-602', '2 BHK', 1306.32, 746.0, 4800, 'open'),
    (v_org, v_p, 'C', 6, 'C-603', '3 BHK', 1757.01, 1100.4, 4800, 'open'),
    (v_org, v_p, 'C', 6, 'C-604', '3 BHK', 1791.56, 1116.0, 4800, 'open'),
    (v_org, v_p, 'C', 7, 'C-701', '2 BHK', 1209.23, 728.2, 4900, 'booked'),
    (v_org, v_p, 'C', 7, 'C-702', '2 BHK', 1306.32, 746.0, 4900, 'open'),
    (v_org, v_p, 'C', 7, 'C-703', '3 BHK', 1757.01, 1100.4, 4900, 'open'),
    (v_org, v_p, 'C', 7, 'C-704', '3 BHK', 1791.56, 1116.0, 4900, 'open'),
    (v_org, v_p, 'C', 8, 'C-801', '2 BHK', 1209.23, 728.2, 4900, 'open'),
    (v_org, v_p, 'C', 8, 'C-802', '2 BHK', 1306.32, 746.0, 4900, 'open'),
    (v_org, v_p, 'C', 8, 'C-803', '3 BHK', 1757.01, 1100.4, 4900, 'open'),
    (v_org, v_p, 'C', 8, 'C-804', '3 BHK', 1791.56, 1116.0, 4900, 'open'),
    (v_org, v_p, 'C', 9, 'C-901', '2 BHK', 1209.23, 728.2, 4900, 'open'),
    (v_org, v_p, 'C', 9, 'C-902', '2 BHK', 1306.32, 746.0, 4900, 'open'),
    (v_org, v_p, 'C', 9, 'C-903', '3 BHK', 1757.01, 1100.4, 4900, 'open'),
    (v_org, v_p, 'C', 9, 'C-904', 'Penthouse', null, null, 4900, 'booked');
end $$;

select name, configs, price_from as "from (lakh)", price_to as "up to (lakh)", size_from, size_to, units,
  (select count(*) from public.project_units u where u.project_id = p.id and u.status = 'open') as open_flats
from public.projects p where name = 'Sumeet Urban Nest';
