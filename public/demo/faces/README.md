# Demonstration faces

AI-generated portraits of **fictional** Nigerian students for the three University Clearance scenarios. Files are
served from `/demo/faces/` and referenced by the demo student records; until a file is present, the app shows a
neutral placeholder. No code change is needed when adding them, but they must be committed and deployed.

## Files

| File | Scenario | Who it shows |
| --- | --- | --- |
| `success-student-jamb.png` | 1. Successful verification (`20250190101CN`, Chiamaka Adaeze Nwankwo, female, 19) | **Person S**, passport style |
| `success-student-nin.png` | 1 | **Person S**, passport style, slightly different photo (other day, small change in expression) |
| `success-student-live.png` | 1 | **Person S**, webcam-style capture |
| `discrepancy-student-jamb.png` | 2. Identity discrepancy (`20250190102IA`, Ibrahim Musa Abdullahi, male, 19) | **Person A**, passport style |
| `discrepancy-student-nin.png` | 2 | **Person B**: a clearly **different** young man, passport style |
| `discrepancy-student-live.png` | 2 | **Person A**, webcam-style capture |
| `duplicate-clearance-student-jamb.png` | 3. Existing clearance elsewhere (`20250190103OA`, Oluwaseun Ayomide Adeyemi, female, 20) | **Person D**, passport style |
| `duplicate-clearance-student-nin.png` | 3 | **Person D**, passport style |
| `duplicate-clearance-student-live.png` | 3 | **Person D**, webcam-style capture |

## Format

- PNG, **600 × 800 px** (3:4 portrait), under ~300 KB each. Lowercase file names exactly as above.
- Passport style (`-jamb`, `-nin`): head and shoulders, facing the camera, neutral expression, plain light grey or
  off-white background, even studio lighting, face centred in the upper half.
- Live capture (`-live`): natural webcam look, indoor office lighting, slightly off-centre, plain wall behind,
  same person as the JAMB portrait.

## Generation prompts

Generate each person once, then reuse the same seed / character reference for their other images so the person is
recognisably the same. Avoid watermarks, text, jewellery that hides the face, and filters.

- **Person S (success):** "Passport photo of a fictional 19-year-old Nigerian woman, dark brown skin, natural black
  hair in neat cornrows, small stud earrings, plain white blouse, neutral expression, plain light grey background,
  soft even lighting, photorealistic, head and shoulders, 3:4."
- **Person A (discrepancy, JAMB + live):** "Passport photo of a fictional 19-year-old Nigerian man, medium brown skin,
  short low-cut hair, clean-shaven, round face, light blue collared shirt, neutral expression, plain light grey
  background, photorealistic, head and shoulders, 3:4."
- **Person B (discrepancy, NIN only):** "Passport photo of a fictional 24-year-old Nigerian man, dark skin, slim
  oval face, short beard and moustache, high-top fade haircut, white shirt, neutral expression, plain white
  background, photorealistic, head and shoulders, 3:4." (Clearly different from Person A: age, face shape, beard.)
- **Person D (existing clearance):** "Passport photo of a fictional 20-year-old Nigerian woman, medium-dark brown
  skin, shoulder-length braids pulled back, oval face, navy top, neutral expression, plain light grey background,
  photorealistic, head and shoulders, 3:4."
- **Live captures:** "Webcam photo of the same person, looking at a laptop camera in a university office, natural
  indoor light, plain wall behind, slight smile, photorealistic, 3:4."
