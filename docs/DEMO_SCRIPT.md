# FitSplit: 3-minute demo script

Follows the guided walkthrough at `/demo`. Each step's hint is also on the floating bar at the
bottom of the screen, so you can read it if you lose your place.

## Before you go on (2 minutes)

1. `npm run dev:all` from the repo root. Or, if the backend won't start, `cd frontend && npm run dev`:
   the demo is fully offline.
2. Open http://localhost:5173/demo in Chrome, full screen, zoom 100% (90% on a small laptop).
3. Click **Reset and start the demo**. This restores the sample data and opens step 1.
4. Keys: **Shift + →** next step, **Shift + ←** back (Page Down / Page Up also work, e.g. with a clicker).

## The script

**0:00 Opening (on step 1, before clicking).**
Say: "Three questions slow down every rental: how big is the room, will my stuff fit, and who pays
what. FitSplit answers all three from one floor plan, for the agent on LeaseHub and for students on
Roombae."

**0:15 Step 1: LeaseHub, the agent posts the listing.**
Click the **JVUE 3 bed** sample plan, wait for the 3D view, then click **3. Publish listing**.
Say: "The agent uploads the floor plan once. We read every wall and room, so the listing gets a 3D
view and every room's size, and the rent and size fields fill in. It's syndicated with the 3D view
attached, so fewer 'how big is the bedroom?' calls."

**0:45 Step 2: Roombae, students match.** (Shift + →)
Click **Meet all matches**. Let the first conversation type for a few seconds, then **Skip to result**.
Then click **Skip to the group**.
Say: "Before anyone meets, each student's AI clone negotiates with the others: budget, sleep,
guests, dealbreakers. This is our teammate Tanvi's roommate engine. Jake's clone is stopped in two
turns, because Priya won't live with a smoker. Priya, Ananya and Meera match. Two of the pairs are
'conditional' and the app says why: the lease length is still open."
Point at the group card: "And it only shows listings where every fair-split share fits each
person's budget." Click **Save group & see it in 3D** on JVUE 3 bed.

**1:25 Step 3: see it in 3D and check the furniture.**
Click **Bedroom 1** (the DREAM card on the right), then **Edit layout**, **Will my stuff fit?**, +1 queen
bed, desk and dresser, **Place 3 along the walls**.
Say: "Will my bed fit? Green means yes, measured against the real walls. It keeps the doorway clear."
Optional: drag the bed into a wall to show red, or click **Front** or **Side**: walls in the way fade out.

**1:55 Step 4: fair rent split + AI check.** (Shift + →)
Say: "Bedroom 3 has its own bathroom, so it pays $88 more than an even split. Code does the math, and
the shares always add up to the rent." Open the **AI check** badge: "Then AI checks our inputs
against the drawing. It spotted that Bedroom 3 also has the balcony and extra closets, and suggests
counting closets. The AI never changes a number; you choose whether to apply its suggestion."

**2:20 Step 5: apply as a group.** (Shift + →)
Say: "One click: every roommate's name and exact share, already matched to their budgets." Click
**Submit group application**.

**2:35 Step 6: LeaseHub, the agent receives it.** (Shift + →)
Say: "The agent gets one application: who's in which room, shares that add up to the rent, the AI
rent check and the clones' compatibility verdict. No back-and-forth, no wasted showings."
Close: "One floor plan in: a 3D listing for the agent, and a matched, pre-checked group for the
landlord."

## If something breaks (30 seconds)

- **A page looks stuck:** click **Reset demo** on the bar (or reload), then jump to the step with
  its number on the bar.
- **Backend or Wi-Fi down:** keep going. Everything in the demo is bundled; the only thing that
  needs the backend is uploading a brand-new floor plan.
- **3D won't render (no WebGL on the projector machine):** switch to `docs/screenshots/`, starting
  at `demo_step1_published.png`, and narrate the same six steps:
  `demo_step1_new_listing.png` → `demo_step2_group.png` → `demo_step3_furniture.png` →
  `demo_step4_rent_check.png` → `demo_step5_apply.png` → `demo_step6_application.png`.
- **30-second version:** "The agent uploads a floor plan once and gets a 3D listing with room sizes.
  Students' AI clones negotiate as roommates, the group checks their furniture in 3D and gets a fair
  split that AI double-checks, then applies together. The agent receives one complete, pre-qualified
  group application."
