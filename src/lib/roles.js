// Where each role lands after signing in. Plain module (no "use client") so
// both Server Components and the client-side nav can import it.
export const HOME_FOR_ROLE = Object.freeze({ admin: "/admin", recruiter: "/recruiter", candidate: "/candidate" });
