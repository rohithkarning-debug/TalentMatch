# Candidate Module test cases

| Area | Case | Expected result |
|---|---|---|
| Authentication | Anonymous GET/PATCH profile, GET/POST skills, GET/POST resumes | 401 JSON error |
| Role authorization | Authenticated recruiter/admin requests candidate endpoints | 403 JSON error |
| Profile | Candidate GET profile | Only the authenticated candidate's user/profile fields returned; no password/hash |
| Profile | Valid PATCH for name, phone, location, headline, experience, education | 200; persisted values returned |
| Profile | Extra key such as `role`, invalid phone, negative experience, blank name | 400; no unauthorized field changes |
| Skills | GET catalogue and own assignments | 200; database-backed results |
| Skills | Add valid catalogue skill | 201; proficiency and years persisted |
| Skills | Add invalid skill ID or proficiency outside 1–5 | 400/404; no assignment created |
| Skills | Delete another candidate's assignment | Cannot remove it; assignment remains owned by original candidate |
| Resumes | Upload valid PDF/text file <= 5 MB with >= 50 chars extracted | 201; metadata persisted; disk name is random and private |
| Resumes | Oversized, unsupported, malformed PDF, or too-short extracted text | 4xx; no resume row or stored file retained |
| Resumes | Delete another candidate's resume | 404; original row/file remains |
| Resumes | Delete own resume referenced by application | Resume row deleted; application row remains with `resume_id = NULL` |
| SQL safety | Profile and skill values include SQL-looking text | Values treated as data via parameterized SQL and validation |
| UI | Candidate dashboard | Profile, skills, resumes load from API; changes refresh the UI |
