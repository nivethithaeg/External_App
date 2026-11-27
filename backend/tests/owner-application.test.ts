import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MP4, approveOwner, createAdmin, createApprovedVenue, registerUser, setup, uniq, type TestEnv } from './helpers.js';

const saveBank = (o: any) => request(env.app).put('/api/owner/profile').set(o.auth).send({ bankAccountName: 'Mehta Sports', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }); // the bank account comes before any add or change
let env: TestEnv; let admin: Awaited<ReturnType<typeof createAdmin>>;
beforeAll(async () => { env = await setup(); admin = await createAdmin(env); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80)]);
const PDF = Buffer.from('%PDF-1.4 sample document body');
const app = (o: any) => request(env.app).get('/api/owner/application').set(o.auth);
const sole = { businessType: 'sole_proprietorship', businessName: 'Mehta Sports', pan: 'abcde1234f', address: '12 Park Road, Indiranagar', state: 'Karnataka', city: 'Bengaluru', pincode: '560038', representativeName: 'Arjun Mehta' };
const doc = (o: any, docType: string, file = PNG, ct = 'image/png') => request(env.app).post('/api/owner/application/documents').set(o.auth).field('docType', docType).attach('file', file, { filename: 'x', contentType: ct });
const newOwner = async (verified = true) => { const o = await registerUser(env, 'owner', { verified }); return o; };

/** Everything the application needs: business details, identity consent and documents. No venue is involved. */
async function completeApplication(o: any, business: object = sole) {
  await request(env.app).put('/api/owner/application/business').set(o.auth).send(business).expect(200);
  await request(env.app).put('/api/owner/application/identity').set(o.auth).send({ aadhaarNumber: '123412341234' }).expect(200);
  for (const t of ['pan_card', 'identity_proof', 'address_proof', 'self_verification']) await doc(o, t).expect(201);
}
const submit = (o: any, body: object = { acceptTerms: true, declaration: true }) => request(env.app).post('/api/owner/application/submit').set(o.auth).send(body);

describe('signup & account status', () => {
  it('creates an owner without a business name; account status follows the facts', async () => {
    const o = await newOwner(false);
    let a = (await app(o).expect(200)).body;
    expect(a.accountStatus).toBe('registered'); expect(a.application.status).toBe('incomplete'); expect(a.contact.emailVerified).toBe(false);
    await env.db.query('UPDATE users SET email_verified=true WHERE id=$1', [o.id]);
    expect((await app(o)).body.accountStatus).toBe('profile_incomplete');
  });
  it('is only available to owners', async () => {
    const c = await registerUser(env, 'customer');
    await request(env.app).get('/api/owner/application').set(c.auth).expect(403);
    await request(env.app).get('/api/owner/application').expect(401);
  });
});

describe('business information by type', () => {
  it('validates PAN, CIN and LLPIN formats and requires the right fields per type', async () => {
    const o = await newOwner();
    const put = (b: object) => request(env.app).put('/api/owner/application/business').set(o.auth).send(b);
    expect((await put({ ...sole, pan: '12345' })).status).toBe(400);
    expect((await put({ ...sole, representativeName: 'R2D2 99' })).status).toBe(400);
    expect((await put({ ...sole, businessType: 'private_limited', designation: 'Director' })).status).toBe(400); // CIN missing
    expect((await put({ ...sole, businessType: 'private_limited', designation: 'Director', registrationNumber: 'BAD' })).status).toBe(400);
    expect((await put({ ...sole, businessType: 'partnership' })).status).toBe(400); // designation missing
    expect((await put({ ...sole, businessType: 'llp', registrationNumber: 'AAB-12' })).status).toBe(400);
    await put({ ...sole, businessType: 'private_limited', designation: 'Director', registrationNumber: 'U12345KA2020PTC123456' }).expect(200);
    await put({ ...sole, businessType: 'llp', registrationNumber: 'AAB-1234' }).expect(200);
    const b = (await app(o)).body.business;
    expect(b).toMatchObject({ type: 'llp', registrationNumber: 'AAB-1234', designation: 'Designated Partner', hasPan: true });
    expect(b.panMasked).toBe('AB•••••4F'); expect(JSON.stringify((await app(o)).body)).not.toContain('ABCDE1234F'); // PAN is masked for the owner
    expect((await app(o)).body.requiredDocs.map((d: any) => d.docType)).toEqual(['identity_proof', 'self_verification']);
  });
  it('supports a One Person Company (CIN) and a Trust / Society / Club (registration number + office-bearer designation), each with its own documents', async () => {
    const o = await newOwner();
    const put = (b: object) => request(env.app).put('/api/owner/application/business').set(o.auth).send(b);
    expect((await put({ ...sole, businessType: 'opc' })).status).toBe(400); // CIN missing
    expect((await put({ ...sole, businessType: 'opc', registrationNumber: 'AAB-1234' })).status).toBe(400); // an LLPIN is not a CIN
    await put({ ...sole, businessType: 'opc', registrationNumber: 'U74999TN2018OPC123456' }).expect(200);
    expect((await app(o)).body.requiredDocs.map((d: any) => d.docType)).toEqual(['identity_proof', 'self_verification']);

    expect((await put({ ...sole, businessType: 'trust_society', registrationNumber: '123/2018' })).status).toBe(400); // designation missing
    expect((await put({ ...sole, businessType: 'trust_society', designation: 'Secretary' })).status).toBe(400); // registration number missing
    expect((await put({ ...sole, businessType: 'trust_society', designation: 'Secretary', registrationNumber: '!!' })).status).toBe(400);
    await put({ ...sole, businessType: 'trust_society', designation: 'Secretary', registrationNumber: 'reg/123/2018' }).expect(200);
    const body = (await app(o)).body;
    expect(body.business).toMatchObject({ type: 'trust_society', registrationNumber: 'REG/123/2018', designation: 'Secretary' });
    expect(body.requiredDocs.map((d: any) => d.docType)).toEqual(['identity_proof', 'self_verification']); // JusGo's Documents step: the Aadhaar copy only
  });
  it('requires the state, city and a valid PIN code of the business address, and reports each by name', async () => {
    const o = await newOwner();
    const put = (b: object) => request(env.app).put('/api/owner/application/business').set(o.auth).send(b);
    const { state: _s, city: _c, pincode: _p, ...noAddress } = sole as any;
    const res = await put(noAddress).expect(400);
    expect(res.body.error.details.map((d: any) => d.path).sort()).toEqual(['city', 'pincode', 'state']);
    expect(JSON.stringify((await put({ ...sole, pincode: '12345' }).expect(400)).body)).toMatch(/6-digit PIN/);
    expect((await put({ ...sole, pincode: '056038' }).expect(400)).body.error.details[0].path).toBe('pincode'); // PIN codes never start with 0
    await put(sole).expect(200);
    expect((await app(o)).body.business).toMatchObject({ state: 'Karnataka', city: 'Bengaluru', pincode: '560038' });
    // the review list names the missing address parts for an owner who has not saved them yet
    const fresh = await newOwner();
    expect((await app(fresh)).body.missing.map((m: any) => m.key)).not.toContain('state'); // not asked until a business type is chosen
  });

  it('stores the self-verification photo (taken live) and lists it with the application', async () => {
    const o = await newOwner();
    await doc(o, 'self_verification', PNG, 'image/png').expect(201);
    const mine = (await app(o)).body.documents.filter((d: any) => d.docType === 'self_verification');
    expect(mine).toHaveLength(1); expect(mine[0].label).toBe('Self verification photo');
    await doc(o, 'self_verification', PNG, 'image/png').expect(201); // retaking replaces it
    expect((await app(o)).body.documents.filter((d: any) => d.docType === 'self_verification')).toHaveLength(1);
    await doc(o, 'self_verification', Buffer.from('%PDF-1.4 not a photo padded padded padded'), 'application/pdf').expect(400); // photos only
  });

  it('asks for the Aadhaar card number (12 digits, kept masked) and records consent when the application is submitted', async () => {
    const o = await newOwner();
    await request(env.app).put('/api/owner/application/identity').set(o.auth).send({}).expect(400); // no number saved yet
    await request(env.app).put('/api/owner/application/identity').set(o.auth).send({ aadhaarNumber: '12345' }).expect(400);
    await request(env.app).put('/api/owner/application/identity').set(o.auth).send({ aadhaarNumber: '1234 1234 5678' }).expect(200);
    expect((await app(o)).body.identity).toMatchObject({ type: 'aadhaar_masked', aadhaarMasked: 'XXXXXXXX5678', consentGiven: false });
    await request(env.app).put('/api/owner/application/identity').set(o.auth).send({}).expect(200); // keeping the saved one
    expect((await env.db.query('SELECT aadhaar_masked FROM owner_onboarding WHERE owner_id=$1', [o.id])).rows[0].aadhaar_masked).toBe('XXXXXXXX5678'); // the full number is never stored
  });
});

describe('private documents', () => {
  it('stores files privately: no URL or storage key is ever returned, only owner and reviewers can view', async () => {
    const o = await newOwner(), other = await newOwner();
    await request(env.app).put('/api/owner/application/business').set(o.auth).send(sole).expect(200);
    const up = await doc(o, 'pan_card').expect(201);
    expect(JSON.stringify(up.body)).not.toMatch(/https?:|owner-docs|storage/);
    expect((await doc(o, 'pan_card', Buffer.from('<script>alert(1)</script> padded padded'), 'image/png')).status).toBe(400); // not a real image
    expect((await doc(o, 'not_a_type')).status).toBe(400);
    expect(JSON.stringify((await app(o)).body)).not.toMatch(/owner-docs|storage_key/);
    const id = up.body.document.id;
    const file = await request(env.app).get(`/api/owner/application/documents/${id}/file`).set(o.auth).expect(200);
    expect(file.headers['content-type']).toBe('image/png'); expect(file.headers['cache-control']).toMatch(/no-store/); expect(file.headers['x-content-type-options']).toBe('nosniff');
    await request(env.app).get(`/api/owner/application/documents/${id}/file`).set(other.auth).expect(403);
    await request(env.app).get(`/api/owner/application/documents/${id}/file`).expect(401);
    const cust = await registerUser(env, 'customer');
    await request(env.app).get(`/api/admin/owner-documents/${id}/file`).set(cust.auth).expect(403);
    await request(env.app).get(`/api/admin/owner-documents/${id}/file`).set(admin.auth).expect(200);
    const sup = await createAdmin(env, 'finance'); // no 'users' permission
    await request(env.app).get(`/api/admin/owner-documents/${id}/file`).set(sup.auth).expect(403);
    const log = await request(env.app).get('/api/admin/audit-logs?entity=owner_document').set(admin.auth).expect(200);
    expect(log.body.logs.some((l: any) => l.action === 'owner_document.view' && l.entity_id === id)).toBe(true);
  });
  it('replacing a document keeps history and venue documents are private too', async () => {
    const fx = await createApprovedVenue(env, admin);
    const docs = (await request(env.app).get(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth)).body.venue.documents;
    expect(docs[0].url).toBeNull();
    const file = await request(env.app).get(`/api/owner/venue-documents/${docs[0].id}/file`).set(fx.owner.auth).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    const stranger = await newOwner();
    await request(env.app).get(`/api/owner/venue-documents/${docs[0].id}/file`).set(stranger.auth).expect(403);
    await request(env.app).get(`/api/admin/venue-documents/${docs[0].id}/file`).set(admin.auth).expect(200);
    expect(JSON.stringify((await request(env.app).get(`/api/admin/venues/${fx.venue.id}`).set(admin.auth)).body.documents)).not.toContain('private:');
  });
});

describe('submission, review, correction and approval', () => {
  it('walks the whole workflow: incomplete → submit → review → corrections → resubmit → approved → active', async () => {
    const o = await newOwner();
    // cannot submit while incomplete; the response lists exactly what is missing
    const early = await submit(o).expect(400);
    expect(early.body.error.code).toBe('incomplete_application');
    expect(early.body.error.details.missing.map((m: any) => m.message).join(' ')).toMatch(/business type/i);
    await completeApplication(o);
    await submit(o, { acceptTerms: true }).expect(400); // declaration required
    await submit(o, { acceptTerms: false, declaration: true }).expect(400);
    const done = await submit(o).expect(200);
    expect(done.body.reference).toMatch(/^KOA-\d{8}-[A-F0-9]{6}$/);
    const a = (await app(o)).body;
    expect(a.application).toMatchObject({ status: 'submitted', reference: done.body.reference, editable: false }); expect(a.accountStatus).toBe('verification_pending');
    expect(a.sections).toEqual({ contact: 'verified', business: 'under_review', identity: 'under_review' }); // no venue section
    await request(env.app).put('/api/owner/application/business').set(o.auth).send(sole).expect(409); // locked while under review
    await submit(o).expect(409);

    // admin sees it and is told
    const list = (await request(env.app).get('/api/admin/applications').set(admin.auth).expect(200)).body.applications;
    expect(list.find((x: any) => x.owner_id === o.id)).toMatchObject({ application_ref: done.body.reference, pending_documents: 4, business_type: 'sole_proprietorship' });
    const detail = (await request(env.app).get(`/api/admin/applications/${o.id}`).set(admin.auth).expect(200)).body;
    expect(detail.owner.pan).toBe('ABCDE1234F'); expect(JSON.stringify(detail)).not.toMatch(/storage_key|password_hash/);
    expect((await request(env.app).get('/api/me/notifications').set(admin.auth)).body.notifications.some((n: any) => n.type === 'admin_application_submitted')).toBe(true);
    expect((await request(env.app).get('/api/me/notifications').set(o.auth)).body.notifications.some((n: any) => n.type === 'application' && n.body.includes(done.body.reference))).toBe(true);

    const decide = (body: object, who = admin) => request(env.app).post(`/api/admin/applications/${o.id}/decision`).set(who.auth).send(body);
    await decide({ action: 'start_review' }).expect(200);
    await decide({ action: 'start_review' }).expect(409);
    // approval is blocked while a document is rejected; asking for changes needs a reason
    const pan = detail.documents.find((d: any) => d.doc_type === 'identity_proof');
    await request(env.app).patch(`/api/admin/owner-documents/${pan.id}`).set(admin.auth).send({ status: 'rejected' }).expect(400);
    await request(env.app).patch(`/api/admin/owner-documents/${pan.id}`).set(admin.auth).send({ status: 'rejected', note: 'PAN image is blurry' }).expect(200);
    await decide({ action: 'approve' }).expect(409);
    await decide({ action: 'request_resubmission' }).expect(400);
    await decide({ action: 'request_resubmission', note: 'Fix your PAN and address', items: [{ type: 'document', key: 'identity_proof', reason: 'PAN image is blurry' }, { type: 'field', key: 'address', reason: 'Add PIN code' }] }).expect(200);

    // owner sees exactly what to fix and can edit again
    const fix = (await app(o)).body;
    expect(fix.application).toMatchObject({ status: 'resubmission_required', editable: true });
    expect(fix.correction.note).toBe('Fix your PAN and address'); expect(fix.correction.items).toHaveLength(2);
    expect(fix.sections.identity).toBe('changes_requested'); expect(fix.sections.business).toBe('changes_requested');
    expect(fix.missing.map((m: any) => m.message).join(' ')).toMatch(/Replace the rejected Aadhaar \/ Government ID copy: PAN image is blurry/);
    expect((await request(env.app).get('/api/me/notifications').set(o.auth)).body.notifications.some((n: any) => n.title === 'Resubmission required' && n.body.includes('PAN image is blurry'))).toBe(true);
    await submit(o).expect(400); // still has the rejected document
    await doc(o, 'identity_proof').expect(201); // replace
    await request(env.app).put('/api/owner/application/business').set(o.auth).send({ ...sole, address: '12 Park Road, Indiranagar, Bengaluru 560038' }).expect(200);
    const again = await submit(o).expect(200);
    expect(again.body.reference).toBe(done.body.reference); // same reference on resubmission

    // admin sees history, then approves
    const hist = (await request(env.app).get(`/api/admin/applications/${o.id}`).set(admin.auth)).body.events.map((e: any) => e.kind);
    for (const k of ['submitted', 'review_started', 'document_reviewed', 'resubmission_requested', 'document_replaced', 'resubmitted']) expect(hist, k).toContain(k);
    const fin = await createAdmin(env, 'finance');
    await decide({ action: 'approve' }, fin).expect(403); // finance admins cannot review applications
    await decide({ action: 'approve' }).expect(200);
    const live = (await app(o)).body;
    expect(live.accountStatus).toBe('active'); expect(live.application.status).toBe('approved'); expect(live.sections.contact).toBe('verified');
    expect((await request(env.app).get('/api/me/notifications').set(o.auth)).body.notifications.some((n: any) => n.title === 'Application approved')).toBe(true);
    // venues are added after approval, and are approved separately
    await saveBank(o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ pincode: '560001', name: 'Mehta Arena', address: '12 Park Road', city: 'Bengaluru', lat: 12.97, lng: 77.59 }).expect(201)).body.venue;
    expect(v.status).toBe('draft');
    await decide({ action: 'approve' }).expect(409);
  });

  it('does not need a venue to apply: venues are added after approval', async () => {
    const o = await newOwner();
    await completeApplication(o);
    expect((await app(o)).body.missing).toEqual([]);
    expect((await app(o)).body.venues).toEqual([]);
    await submit(o).expect(200);
  });

  it('shows a submitted application, with its pending documents, on the admin dashboard and the Turf owners list', async () => {
    const before = (await request(env.app).get('/api/admin/dashboard').set(admin.auth)).body.pendingOwners;
    const o = await newOwner(); await completeApplication(o); await submit(o).expect(200);
    expect((await request(env.app).get('/api/admin/dashboard').set(admin.auth)).body.pendingOwners).toBe(before + 1);
    const row = (await request(env.app).get('/api/admin/owners').set(admin.auth)).body.owners.find((x: any) => x.id === o.id);
    expect(row).toMatchObject({ application_status: 'submitted', pending_documents: 4 }); expect(row.application_ref).toMatch(/^KOA-/);
    await request(env.app).post(`/api/admin/applications/${o.id}/decision`).set(admin.auth).send({ action: 'approve' }).expect(200);
    expect((await request(env.app).get('/api/admin/dashboard').set(admin.auth)).body.pendingOwners).toBe(before); // approved applications leave the queue
  });

  it('verifies Business and Identity separately and each status card on the owner screen follows', async () => {
    const o = await newOwner(); await completeApplication(o); await submit(o).expect(200);
    const sec = (section: string, verified: boolean, who = admin) => request(env.app).post(`/api/admin/applications/${o.id}/sections`).set(who.auth).send({ section, verified });
    const cards = async () => (await app(o)).body.sections;
    expect(await cards()).toEqual({ contact: 'verified', business: 'under_review', identity: 'under_review' });

    // not verifiable while documents are still pending: the reason names them
    const early = await sec('identity', true).expect(409);
    expect(early.body.error.code).toBe('section_not_ready'); expect(early.body.error.message).toMatch(/PAN card is pending/);

    // reviewing documents starts the review; approving them alone does not yet verify the section
    const docs = (await request(env.app).get(`/api/admin/applications/${o.id}`).set(admin.auth)).body.documents;
    for (const d of docs) await request(env.app).patch(`/api/admin/owner-documents/${d.id}`).set(admin.auth).send({ status: 'approved' }).expect(200);
    expect((await app(o)).body.application.status).toBe('under_review');
    expect((await cards()).identity).toBe('under_review');

    // verify identity: only that card changes
    const r1 = await sec('identity', true).expect(200);
    expect(r1.body).toMatchObject({ identityVerified: true, businessVerified: false });
    expect(await cards()).toEqual({ contact: 'verified', business: 'under_review', identity: 'verified' });
    expect((await request(env.app).get('/api/me/notifications').set(o.auth)).body.notifications.some((n: any) => n.title === 'Identity verified')).toBe(true);
    // then business; the application as a whole is still not approved
    await sec('business', true).expect(200);
    expect(await cards()).toEqual({ contact: 'verified', business: 'verified', identity: 'verified' });
    expect((await app(o)).body.application.status).toBe('under_review'); expect((await app(o)).body.accountStatus).toBe('verification_pending');
    const history = (await request(env.app).get(`/api/admin/applications/${o.id}`).set(admin.auth)).body.events.map((e: any) => e.kind);
    expect(history).toEqual(expect.arrayContaining(['section_verified', 'review_started']));

    // a later rejection withdraws that section's verification again
    const pan = docs.find((d: any) => d.doc_type === 'pan_card');
    await request(env.app).patch(`/api/admin/owner-documents/${pan.id}`).set(admin.auth).send({ status: 'rejected', note: 'Blurry' }).expect(200);
    expect((await cards()).identity).toBe('changes_requested'); expect((await cards()).business).toBe('verified');
    await sec('identity', true).expect(409); // cannot re-verify until the document is fixed
    // verification can be taken back, and only by authorised admins
    await sec('business', false).expect(200); expect((await cards()).business).toBe('under_review');
    const fin = await createAdmin(env, 'finance');
    await sec('business', true, fin).expect(403);
    await request(env.app).post(`/api/admin/applications/${o.id}/sections`).send({}).expect(401);
  });

  it('final approval verifies both sections, and a flagged item withdraws its section', async () => {
    const o = await newOwner(); await completeApplication(o); await submit(o).expect(200);
    const decide = (b: object) => request(env.app).post(`/api/admin/applications/${o.id}/decision`).set(admin.auth).send(b);
    const sec = (section: string) => request(env.app).post(`/api/admin/applications/${o.id}/sections`).set(admin.auth).send({ section, verified: true });
    const docs = (await request(env.app).get(`/api/admin/applications/${o.id}`).set(admin.auth)).body.documents;
    for (const d of docs) await request(env.app).patch(`/api/admin/owner-documents/${d.id}`).set(admin.auth).send({ status: 'approved' }).expect(200);
    await sec('identity').expect(200); await sec('business').expect(200);
    await decide({ action: 'request_info', note: 'Check the address', items: [{ type: 'field', key: 'address', reason: 'Add PIN code' }] }).expect(200);
    expect((await app(o)).body.sections).toMatchObject({ business: 'changes_requested', identity: 'verified' }); // only the flagged section is withdrawn
    await request(env.app).put('/api/owner/application/business').set(o.auth).send(sole).expect(200); // editing details also needs re-verification
    await submit(o).expect(200);
    await decide({ action: 'approve' }).expect(200);
    expect((await app(o)).body.sections).toEqual({ contact: 'verified', business: 'verified', identity: 'verified' });
  });

  it('tells the owner immediately, with the reason, when a document is rejected', async () => {
    const o = await newOwner(); await completeApplication(o); await submit(o).expect(200);
    const docs = (await request(env.app).get('/api/admin/applications/' + o.id).set(admin.auth)).body.documents;
    await request(env.app).patch('/api/admin/owner-documents/' + docs[0].id).set(admin.auth).send({ status: 'rejected', note: 'Name on the document does not match' }).expect(200);
    const n = (await request(env.app).get('/api/me/notifications').set(o.auth)).body.notifications.find((x: any) => x.title === 'Document rejected');
    expect(n.body).toContain('Name on the document does not match'); expect(n.data.link).toBe('/owner/application');
    expect(env.emails.some((e) => e.to === o.email && e.subject === 'Document rejected')).toBe(true);
  });

  it('reject needs a reason, ends the application, and the owner can see why', async () => {
    const o = await newOwner(); await completeApplication(o); await submit(o).expect(200);
    const decide = (b: object) => request(env.app).post(`/api/admin/applications/${o.id}/decision`).set(admin.auth).send(b);
    await decide({ action: 'reject' }).expect(400);
    await decide({ action: 'reject', note: 'PAN does not match the business name' }).expect(200);
    const a = (await app(o)).body;
    expect(a.accountStatus).toBe('rejected'); expect(a.application.status).toBe('rejected'); expect(a.application.editable).toBe(false);
    expect((await request(env.app).get('/api/me/notifications').set(o.auth)).body.notifications.some((n: any) => n.title === 'Application rejected' && n.body.includes('PAN does not match'))).toBe(true);
  });

  it('the older one-click owner verification keeps the application status in sync', async () => {
    const o = await newOwner();
    await request(env.app).post(`/api/admin/owners/${o.id}/verification`).set(admin.auth).send({ status: 'verified' }).expect(200);
    expect((await app(o)).body.accountStatus).toBe('active');
  });
});

describe('unexpected failures', () => {
  it('return a reference the owner can quote to support instead of a bare error', async () => {
    const o = await newOwner();
    const real = env.ctx.db.query.bind(env.ctx.db);
    (env.ctx.db as any).query = async (sql: string, p?: unknown[]) => { if (/FROM application_events WHERE owner_id/.test(sql)) throw new Error('boom'); return real(sql, p); };
    try {
      const res = await app(o).expect(500);
      expect(res.body.error.reference).toMatch(/^[A-Z0-9]{4,6}$/);
      expect(res.body.error.message).toContain(res.body.error.reference);
    } finally { (env.ctx.db as any).query = real; }
  });
});

describe('owner endpoints need an approved owner', () => {
  const venue = { name: 'Mehta Arena', address: '12 Park Road', city: 'Bengaluru', pincode: '560038', lat: 12.97, lng: 77.59 };
  it('lets an unapproved owner look at every page but refuses every add or change until the application is approved', async () => {
    const o = await newOwner();
    for (const path of ['/api/owner/venues', '/api/owner/overview', '/api/owner/areas', '/api/owner/bookings', '/api/owner/settlements', '/api/owner/security/login-history']) {
      await request(env.app).get(path).set(o.auth).expect(200); // looking is allowed: the pages open (empty, nothing is theirs yet)
    }
    for (const [method, path] of [['post', '/api/owner/areas/00000000-0000-4000-8000-000000000000/blocks'], ['put', '/api/owner/areas/00000000-0000-4000-8000-000000000000'], ['post', '/api/owner/customers'], ['post', '/api/owner/staff']] as const) {
      const res = await (request(env.app) as any)[method](path).set(o.auth).send({}).expect(403);
      expect(res.body.error.code, path).toBe('owner_not_approved');
    }
    const create = await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(403);
    expect(create.body.error.message).toMatch(/approved by PlaynX/);
    expect((await app(o).expect(200)).body.accountStatus).toBe('profile_incomplete'); // the application, profile and notifications still work
    await request(env.app).get('/api/me/notifications').set(o.auth).expect(200);

    // still blocked while under review, and after a rejection
    await completeApplication(o); await submit(o).expect(200);
    await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(403);
    await request(env.app).post(`/api/admin/applications/${o.id}/decision`).set(admin.auth).send({ action: 'reject', note: 'Mismatch' }).expect(200);
    await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(403);
  });
  it('opens as soon as the admin approves the application, and nobody else is affected', async () => {
    const o = await newOwner(), bystander = await newOwner();
    await completeApplication(o); await submit(o).expect(200);
    await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(403);
    await request(env.app).post(`/api/admin/applications/${o.id}/decision`).set(admin.auth).send({ action: 'approve' }).expect(200);
    await saveBank(o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(201)).body.venue;
    expect(v.status).toBe('draft');
    await request(env.app).get('/api/owner/overview').set(o.auth).expect(200);
    await request(env.app).post('/api/owner/venues').set(bystander.auth).send(venue).expect(403); // a different, unapproved owner is still blocked
  });
  it('a venue needs a valid 6-digit PIN code when it is created', async () => {
    const o = await newOwner(); await approveOwner(env, admin, o);
    const { pincode: _p, ...noPin } = venue as any;
    const missing = await request(env.app).post('/api/owner/venues').set(o.auth).send(noPin).expect(400);
    expect(missing.body.error.details.map((d: any) => d.path)).toContain('pincode');
    for (const bad of ['12345', '056038', 'ABCDEF', '5600381']) {
      const r = await request(env.app).post('/api/owner/venues').set(o.auth).send({ ...venue, pincode: bad }).expect(400);
      expect(JSON.stringify(r.body)).toMatch(/6-digit PIN/);
    }
    await saveBank(o);
    const ok = (await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(201)).body.venue;
    expect(ok.pincode).toBe('560038');
    await request(env.app).put(`/api/owner/venues/${ok.id}`).set(o.auth).send({ name: 'Renamed' }).expect(200); // updates may omit it
    await request(env.app).put(`/api/owner/venues/${ok.id}`).set(o.auth).send({ pincode: 'nope' }).expect(400);
  });

  it('a venue cannot be submitted without the electricity bill, even with other documents', async () => {
    const o = await newOwner(); await approveOwner(env, admin, o);
    await saveBank(o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(201)).body.venue;
    const football = (await request(env.app).get('/api/sports')).body.sports.find((s: any) => s.slug === 'football');
    const area = (await request(env.app).post(`/api/owner/venues/${v.id}/areas`).set(o.auth).send({ name: 'Main', sportIds: [football.id] }).expect(201)).body.area;
    await request(env.app).put(`/api/owner/areas/${area.id}/pricing`).set(o.auth).send({ rules: [{ startTime: '06:00', endTime: '23:00', pricePerHour: 800 }] }).expect(204);
    await request(env.app).put(`/api/owner/areas/${area.id}/availability`).set(o.auth).send({ days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '23:00' })) }).expect(204);
    await request(env.app).post(`/api/owner/venues/${v.id}/media`).set(o.auth).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(201);
    await request(env.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Ownership / lease deed').attach('file', PDF, { filename: 'l.pdf', contentType: 'application/pdf' }).expect(201);
    const early = await request(env.app).post(`/api/owner/venues/${v.id}/submit`).set(o.auth).expect(400);
    expect(early.body.error.details.missing).toEqual(['the electricity bill (upload it under Venue documents)', 'the land proof (upload it under Venue documents)', 'a geo-tagged video recorded at the venue']);
    await request(env.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Electricity bill').attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' }).expect(201);
    await request(env.app).post(`/api/owner/venues/${v.id}/documents`).set(o.auth).field('docType', 'Land proof').attach('file', PDF, { filename: 'land.pdf', contentType: 'application/pdf' }).expect(201);
    await request(env.app).post(`/api/owner/venues/${v.id}/media/geo-video`).set(o.auth).field('lat', String(v.lat)).field('lng', String(v.lng)).field('accuracy', '10').attach('file', MP4, { filename: 'tour.mp4', contentType: 'video/mp4' }).expect(201);
    expect((await request(env.app).post(`/api/owner/venues/${v.id}/submit`).set(o.auth).expect(200)).body.status).toBe('pending');
  });

  it('a suspended owner is blocked everywhere, including these endpoints', async () => {
    const o = await newOwner();
    await request(env.app).post(`/api/admin/owners/${o.id}/verification`).set(admin.auth).send({ status: 'verified' }).expect(200);
    await saveBank(o);
    await request(env.app).post('/api/owner/venues').set(o.auth).send(venue).expect(201);
    await request(env.app).patch(`/api/admin/users/${o.id}`).set(admin.auth).send({ isActive: false }).expect(200);
    await request(env.app).get('/api/owner/venues').set(o.auth).expect(401);
  });
});

describe('login, recovery and sessions', () => {
  it('logs in with email or mobile number, honours "remember me", and explains a suspension', async () => {
    const email = `${uniq('p')}@test.dev`;
    await request(env.app).post('/api/auth/register').send({ email, password: 'Passw0rdTest', fullName: 'Phone Owner', phone: '+919811122233', role: 'owner' }).expect(201);
    for (const id of [email, '+919811122233', '9811122233', ' 98111 22233 '.trim().replace(' ', '')]) await request(env.app).post('/api/auth/login').send({ email: id, password: 'Passw0rdTest' }).expect(200);
    await request(env.app).post('/api/auth/login').send({ email: '9000000000', password: 'Passw0rdTest' }).expect(401);
    const long = jwt.decode((await request(env.app).post('/api/auth/login').send({ email, password: 'Passw0rdTest', remember: true })).body.token) as any;
    const short = jwt.decode((await request(env.app).post('/api/auth/login').send({ email, password: 'Passw0rdTest', remember: false })).body.token) as any;
    expect(long.exp - long.iat).toBe(30 * 86400); expect(short.exp - short.iat).toBe(12 * 3600);
    await env.db.query('UPDATE users SET is_active=false WHERE email=$1', [email]);
    const res = await request(env.app).post('/api/auth/login').send({ email, password: 'Passw0rdTest' }).expect(403);
    expect(res.body.error.message).toMatch(/suspended.*support/i);
  });
  it('reset requires matching passwords, signs out old sessions and tells the owner', async () => {
    const o = await newOwner();
    env.clock.offsetMs = 60_000;
    try {
      await request(env.app).post('/api/auth/forgot-password').send({ email: o.email }).expect(200);
      const code = /(\d{6})/.exec(env.emails.filter((e) => e.to === o.email).at(-1)!.html.replace(/<[^>]+>/g, ' '))![1];
      await request(env.app).post('/api/auth/reset-password').send({ email: o.email, code, newPassword: 'BrandNew123', confirmPassword: 'Different123' }).expect(400);
      await request(env.app).post('/api/auth/reset-password').send({ email: o.email, code, newPassword: 'BrandNew123', confirmPassword: 'BrandNew123' }).expect(200);
    } finally { env.clock.offsetMs = 0; }
    await request(env.app).get('/api/auth/me').set(o.auth).expect(401);
    expect(env.emails.some((e) => e.to === o.email && e.subject === 'Your password was changed')).toBe(true);
  });
  it('forgot-password answers identically for unknown emails and mobile numbers', async () => {
    const a = await request(env.app).post('/api/auth/forgot-password').send({ email: 'nobody@test.dev' }).expect(200);
    const b = await request(env.app).post('/api/auth/forgot-password').send({ email: '9000000001' }).expect(200);
    expect(a.body).toEqual(b.body);
  });
});

describe('publishing a venue', () => {
  it('is refused while incomplete, and goes under approval when complete, and is live only after an admin approves', async () => {
    const o = await registerUser(env, 'owner'); await approveOwner(env, admin, o);
    await saveBank(o);
    const v = (await request(env.app).post('/api/owner/venues').set(o.auth).send({ name: 'Pub Arena', address: '1 Rd, Indiranagar', city: 'Bengaluru', pincode: '560038', lat: 12.9, lng: 77.5, cancellationHours: 24 })).body.venue;
    const early = await request(env.app).post(`/api/owner/venues/${v.id}/send-for-approval`).set(o.auth);
    expect(early.status).toBe(400); expect(early.body.error.code).toBe('incomplete_venue');
    const fx = await createApprovedVenue(env, admin); // a complete venue
    const rules = (await request(env.app).get(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth)).body.venue.areas[0].pricing;
    expect(Array.isArray(rules)).toBe(true);
    await env.db.query(`UPDATE venues SET status='draft' WHERE id=$1`, [fx.venue.id]);
    const ok = await request(env.app).post(`/api/owner/venues/${fx.venue.id}/send-for-approval`).set(fx.owner.auth);
    expect(ok.status).toBe(200); expect(ok.body.status).toBe('pending');
    expect((await request(env.app).get(`/api/venues/${fx.venue.id}`)).status).toBe(404); // hidden until approved
    const locked = async (r: any) => { expect(r.status).toBe(409); expect(r.body.error.code).toBe('venue_locked'); };
    await locked(await request(env.app).put(`/api/owner/venues/${fx.venue.id}`).set(fx.owner.auth).send({ name: 'Changed' }));
    await locked(await request(env.app).post(`/api/owner/venues/${fx.venue.id}/areas`).set(fx.owner.auth).send({ name: 'X', sportIds: [] }));
    expect((await env.db.query('SELECT name FROM venues WHERE id=$1', [fx.venue.id])).rows[0].name).not.toBe('Changed');
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/decision`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    expect((await env.db.query('SELECT status FROM venues WHERE id=$1', [fx.venue.id])).rows[0].status).toBe('ready'); // approved, but not shown yet
    expect((await request(env.app).get(`/api/venues/${fx.venue.id}`)).status).toBe(404);
    expect((await request(env.app).get('/api/venues').query({ q: 'Green' })).body.venues?.some?.((x: any) => x.id === fx.venue.id) ?? false).toBe(false);
    expect((await request(env.app).post(`/api/admin/venues/${fx.venue.id}/publish`).set(admin.auth)).status).toBe(404); // not an admin action
    expect((await request(env.app).post(`/api/owner/venues/${fx.venue.id}/publish`).set(fx.owner.auth)).status).toBe(200);
    expect((await request(env.app).get(`/api/venues/${fx.venue.id}`)).status).toBe(200);
    expect((await request(env.app).post(`/api/owner/venues/${fx.venue.id}/unpublish`).set(fx.owner.auth)).status).toBe(200);
    expect((await request(env.app).get(`/api/venues/${fx.venue.id}`)).status).toBe(404);
  });
});

describe('prices and hours do not block approval', () => {
  it('the admin can approve without them; the owner cannot publish until they exist', async () => {
    const fx = await createApprovedVenue(env, admin);
    await request(env.app).post(`/api/owner/venues/${fx.venue.id}/unpublish`).set(fx.owner.auth).expect(200);
    await env.db.query(`UPDATE venues SET status='pending' WHERE id=$1`, [fx.venue.id]);
    await env.db.query(`DELETE FROM pricing_rules WHERE area_id=$1`, [fx.area.id]);
    await request(env.app).post(`/api/admin/venues/${fx.venue.id}/decision`).set(admin.auth).send({ decision: 'approve' }).expect(200);
    const early = await request(env.app).post(`/api/owner/venues/${fx.venue.id}/publish`).set(fx.owner.auth);
    expect(early.status).toBe(400); expect(early.body.error.code).toBe('venue_not_ready');
    await request(env.app).put(`/api/owner/areas/${fx.area.id}/pricing`).set(fx.owner.auth).send({ rules: [{ sportId: null, dayType: 'all', startTime: '06:00', endTime: '23:00', pricePerHour: 700 }] }).expect(204);
    await request(env.app).put(`/api/owner/areas/${fx.area.id}/availability`).set(fx.owner.auth).send({ days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '06:00', closeTime: '22:00', isClosed: false })) }).expect(204);
    await request(env.app).post(`/api/owner/venues/${fx.venue.id}/publish`).set(fx.owner.auth).expect(200);
  });
});
