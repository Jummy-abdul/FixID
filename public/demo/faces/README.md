# Demonstration faces

Fictional, AI-generated portraits for the three University Clearance scenarios, in `jamb/`. They are visual demo
assets only: they are not biometric evidence, and every match or mismatch shown in the demo is predefined (simulated).
The app references them from `src/jamb/portraits.ts`; a missing file falls back to a neutral placeholder.

| File | Scenario | Used as |
| --- | --- | --- |
| `jamb/s1_jamb.jpg` | 1. Successful verification (`20250190101CN`, Chiamaka Adaeze Nwankwo) | JAMB registration portrait (profile image) |
| `jamb/s1_nin.jpg` | 1 | NIN identity record portrait (same student) |
| `jamb/s1_live.jpg` | 1 | Capture revealed by *Capture Face* (same student, different hairstyle) |
| `jamb/s2_jamb.jpg` | 2. Examination impersonation (`20250190102IA`, Ibrahim Musa Abdullahi) | JAMB examination verification record: the person who sat the UTME (an impersonator, **not** the student) |
| `jamb/s2_nin.jpg` | 2 | NIN identity record portrait of the genuine student |
| `jamb/s2_live.jpg` | 2 | Live clearance capture revealed by *Capture Face* (the genuine student, same person as `s2_nin`) |
| `jamb/s3_jamb.jpg` | 3. Existing clearance elsewhere (`20250190103OA`, Oluwaseun Ayomide Adeyemi) | JAMB registration portrait (the existing clearance is found at lookup; no capture is needed) |

All seven are 512 × 496 px JPEGs. To replace a portrait, overwrite the file with the same name (JPEG, ideally 600 × 800 px or larger, portrait
orientation) and redeploy.
