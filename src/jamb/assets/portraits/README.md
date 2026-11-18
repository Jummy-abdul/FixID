# Candidate portraits

Drop licensed photographic portraits of fictional people here; no code change is needed.

## Test candidates (`candidates/`)

| File | Who |
| --- | --- |
| `U-A-registration.jpg`, `U-A-demo.jpg` | Candidate A (university): Chiamaka Nwankwo. Two photos of the same person. |
| `U-B-registration.jpg`, `U-B-demo.jpg` | Candidate B (university): Ibrahim Abdullahi. Two photos of the same person. |
| `U-C-registration.jpg`, `U-C-demo.jpg` | Candidate C (university): Oluwaseun Adeyemi. Two photos of the same person. |
| `N-A-registration.jpg`, `N-A-demo.jpg` | Candidate A (NYSC): Emeka Obi. Two photos of the same person. |
| `N-B-registration.jpg`, `N-B-demo.jpg` | Candidate B (NYSC): Fatima Bello. The demo photo must be a **different** person (face mismatch). |
| `N-C-registration.jpg`, `N-C-demo.jpg` | Candidate C (NYSC): Babatunde Ogunleye. Two photos of the same person. |

**Format:** `.jpg`, `.jpeg`, `.png` or `.webp`, with the extension in **lowercase** (`.JPG` is not picked up). File names are case-sensitive and must match exactly.

**Size:** 600 × 800 px (3:4 portrait), at least 450 × 600 px, ideally under 200 KB each. Head and shoulders, face centred in the upper half, plain light background, even lighting. The images are cropped to fill their frames (largest display about 256 × 288 px), so keep the face away from the edges.

**Rebuild:** images are bundled at build time. After adding them, commit and push (or restart the dev server).

## Other students (`pool/`)

Optional: `female-01.jpg`, `female-02.jpg`, … and `male-01.jpg`, … are assigned to the other student records
deterministically. Without them, those records show a neutral "portrait on file" placeholder.
