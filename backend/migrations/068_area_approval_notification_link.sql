-- "Playing area awaiting approval" notifications opened the venues page; they open the playing area approvals page now.
UPDATE notifications SET data = jsonb_set(data, '{link}', '"/admin/area-approvals"') WHERE type = 'admin_area_created';
