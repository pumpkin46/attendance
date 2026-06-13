# Attendance Platform - User Guide

A hands-on guide to using the AI Attendance Platform: signing in, enrolling
faces, running check-ins, managing employees and visitors, configuring devices,
and reviewing attendance, security alerts, and compliance data.

This guide describes the web application exactly as it appears on screen.
Button names, tab names, and field labels are shown **in bold** so you can match
them to what you see. Navigation is written as a breadcrumb, for example
**People > Employees**, meaning: open the **People** group in the left sidebar,
then click **Employees**.

---

## Contents

1. [Before you begin](#1-before-you-begin)
2. [Key concepts](#2-key-concepts)
3. [Getting started](#3-getting-started)
   - [3.1 First-run setup](#31-first-run-setup)
   - [3.2 Signing in](#32-signing-in)
   - [3.3 Creating an account](#33-creating-an-account)
   - [3.4 Finding your way around](#34-finding-your-way-around)
   - [3.5 Your profile and password](#35-your-profile-and-password)
4. [The Dashboard](#4-the-dashboard)
5. [People](#5-people)
   - [5.1 Employees](#51-employees)
   - [5.2 Face enrollment](#52-face-enrollment)
   - [5.3 Visitors](#53-visitors)
6. [Face recognition](#6-face-recognition)
   - [6.1 Live Kiosk](#61-live-kiosk)
   - [6.2 Liveness and recognition testing](#62-liveness-and-recognition-testing)
   - [6.3 AI Engine](#63-ai-engine)
   - [6.4 Unknown Faces review](#64-unknown-faces-review)
7. [Attendance](#7-attendance)
   - [7.1 Attendance records](#71-attendance-records)
   - [7.2 Anomalies](#72-anomalies)
   - [7.3 Shifts, policies, holidays, and leave](#73-shifts-policies-holidays-and-leave)
8. [Devices](#8-devices)
   - [8.1 Cameras](#81-cameras)
   - [8.2 RFID readers and cards](#82-rfid-readers-and-cards)
9. [Reports and compliance](#9-reports-and-compliance)
   - [9.1 Reports and AI security monitoring](#91-reports-and-ai-security-monitoring)
   - [9.2 Audit logs](#92-audit-logs)
   - [9.3 Privacy and GDPR](#93-privacy-and-gdpr)
10. [Administration](#10-administration)
    - [10.1 Users and permissions](#101-users-and-permissions)
    - [10.2 Security and tenancy](#102-security-and-tenancy)
11. [Permissions reference](#11-permissions-reference)
12. [Troubleshooting](#12-troubleshooting)
13. [Glossary](#13-glossary)

---

## 1. Before you begin

**Who this guide is for.** Administrators, HR staff, reception and security
operators, and anyone who signs in to review attendance. Some pages are limited
to specific roles; where that matters, the section names the permission you
need. See [Permissions reference](#11-permissions-reference).

**What you need.**

- A modern web browser.
- The address of your platform (for the bundled Windows installer this is
  usually `http://localhost:8080`).
- An account. The very first account is created during
  [first-run setup](#31-first-run-setup); after that, an administrator creates
  accounts for everyone else.
- A working webcam for any task that captures a face (enrollment, the kiosk, and
  the liveness test).

**How notes are marked in this guide.**

> **Note:** background information that helps you understand a screen.

> **Tip:** a shortcut or best practice.

> **Caution:** an action that is permanent or affects other people.

---

## 2. Key concepts

A few ideas appear throughout the platform. Understanding them first makes every
later section easier.

**Users vs. employees vs. visitors.** These are three separate things:

- A **user** is a login account for this web application - someone who signs in
  with an email and password to administer the system. Users are managed under
  **Administration > Users & Permissions**.
- An **employee** is a person in your workforce whose attendance is tracked.
  Employees do not sign in; they are recognized by face or RFID card. Employees
  are managed under **People > Employees**.
- A **visitor** is a temporary guest (contractor, interviewee, delivery) managed
  under **People > Visitors**.

A person can be both a user and an employee, but the two records are independent.

**Roles and permissions.** What each user can see and do is controlled by
**roles**. A role is a named bundle of **permissions** (for example
`employees.manage` or `cameras.manage`). The left sidebar automatically hides
any page you do not have permission to open, so two users may see different
menus. A **Super Admin** bypasses all permission checks and sees everything.

**How attendance is recorded.** Attendance can be captured three ways:

1. **Face recognition** - a camera or the on-screen kiosk identifies an enrolled
   face, confirms the person is live (not a photo or screen), and records a
   check-in or check-out automatically.
2. **RFID** - an employee taps a registered card on a physical reader.
3. **Manual entry** - an administrator records or corrects an entry by hand on
   the **Attendance** page.

To prevent double counting, a repeated recognition within a short window is
ignored ("duplicate prevented").

**The organization directory.** Your data is organized as
**Organizations > Branches > Departments**, with **Locations** where cameras and
readers are installed. Most installations use a single organization; the
structure exists so larger deployments can keep each organization's data
separate.

---

## 3. Getting started

### 3.1 First-run setup

The first time the platform is opened on a fresh install, it shows a one-time
**setup wizard** that creates the database, names your organization, and creates
the first administrator. The wizard has three steps, shown as a progress
indicator at the top: **Database**, **Organization**, **Administrator**.

> **Note:** The wizard only appears on a brand-new install. Once setup is
> complete, the app sends you straight to the sign-in screen and the wizard is
> no longer reachable.

**Step 1 - Database.**

1. On the **Database** step, leave the **Database name** as the default
   (`attendance`) or type your own. The name may contain only letters, digits,
   and underscores, and must not start with a digit.
2. Click **Create database & run migrations**.
3. A live progress bar and log appear, showing **Running migrations...**. Wait
   for it to finish; when it reads **Database ready** with a green check, click
   **Continue**. If it reports **Migration failed**, click **Retry**.

> **Note:** If you refresh the page while migrations are running, the wizard
> reconnects and keeps showing progress - you will not lose your place.

**Step 2 - Organization.**

1. Type your company name into **Organization name** (for example,
   `Acme Corporation`).
2. Click **Continue**. This name appears in the top bar and on reports, and you
   can rename it later.

**Step 3 - Administrator.**

1. Enter **Your name**, your **Email**, and a **Password** of at least 8
   characters. Use the eye icon to reveal what you typed.
2. Re-enter the password in **Confirm password**.
3. Click **Complete setup**. You are taken to the sign-in screen with the
   message *"Setup complete - sign in with your new administrator account."*

This first administrator has full access; you can add team members and define
their roles afterward.

### 3.2 Signing in

1. Open the platform; you will land on the **Welcome back** sign-in screen.
2. Enter your **Email** and **Password** (the eye icon reveals the password).
3. Click **Sign in**.

If your credentials are wrong you will see *"Invalid email or password. Please
try again."* If you do not have an account yet, click **Create one** to open the
registration screen (only available if self-registration is enabled - see
below).

### 3.3 Creating an account

If your administrator has enabled self-registration:

1. On the sign-in screen click **Create one**, or go to the **Create your
   account** screen.
2. Enter your **Full name**, **Email**, a **Password** (at least 8 characters),
   and **Confirm password**.
3. Click **Create account**. You are signed in immediately.

> **Note:** Self-registration is often turned off. When it is, the screen shows
> *"Self-registration is currently disabled. Ask an administrator to create your
> account."* In that case, your administrator creates your account under
> [Users and permissions](#101-users-and-permissions).

### 3.4 Finding your way around

After signing in you see the main application:

- **Left sidebar** - the menu, organized into collapsible groups: **Overview**,
  **People**, **Face Recognition**, **Attendance**, **Devices**, **Reports &
  Compliance**, and **Administration**. Use the **Search menu...** box at the top
  of the sidebar to jump to a page by name. The panel-toggle button in the top
  bar collapses the sidebar to icons to give you more room.
- **Top bar** - the sidebar toggle on the left and your **user menu** on the
  right.
- **User menu** (top-right) - click your name and avatar to open a panel showing
  your name, email, role, organization, and the real-time connection status
  (**Live**, **Connecting**, or **Offline**). From here you can open **My
  account** or **Sign out**.

> **Note:** The menu adapts to your permissions. If a group or page is missing,
> your account does not have access to it.

### 3.5 Your profile and password

Open the user menu (top-right) and click **My account** to reach the **My
account** page.

**Edit your details.**

1. In the **Account details** card, click **Edit**.
2. Update your **Full name** and/or **Email**.
3. Click **Save changes** (enabled only once you change something). A
   *"Profile updated"* confirmation appears. Click **Cancel** to discard.

> **Caution:** Changing your email changes the address you sign in with. Use the
> new address next time.

**Change your password** (password accounts only).

1. In the **Password** card, enter your **Current password**.
2. Enter a **New password** (at least 8 characters) and repeat it in **Confirm
   new password**.
3. Click **Update password**. A *"Password updated"* confirmation appears.

The **Roles & permissions** card lists the roles and effective permissions your
administrator has granted you.

---

## 4. The Dashboard

**Where:** Overview > Dashboard (the home page). **Who:** any signed-in user.

The Dashboard is a live, read-only overview of the day. It refreshes
automatically (roughly every few seconds) as events occur.

**At the top - six summary cards.** Each card is a shortcut: click it to open a
pre-filtered detail page.

| Card | Shows | Opens |
|------|-------|-------|
| **Active cameras** | Online / total cameras | Cameras, filtered to online |
| **Present** | Employees present today | Attendance, present |
| **Absent** | Employees absent today | Attendance, absent |
| **Late** | Employees late today | Attendance, late |
| **Unknown today** | Unidentified people seen today | Unknown Faces, today |
| **Active visitors** | Visitors currently on site | Visitors, on site |

**Camera health** (left panel) - an online/total badge, mini-stats for
**Online**, **Offline**, **Avg FPS**, and **Avg latency**, and a scrollable list
of cameras each showing a status dot and an **Online** or **Offline** badge.
Click **View all** to open the full camera list.

**Live events feed** (right panel) - recognition and access events as they
happen, newest first. Click any event row to open the **Event details** side
panel, which shows a snapshot (when available) plus details such as **Camera**,
**Confidence**, **Liveness**, the recorded attendance action, and the employee or
visitor involved. For an unrecognized face, the panel offers an **Open Unknown
Faces** button to investigate. Click **Close** to dismiss the panel.

> **Tip:** Hover over an event's relative time (for example "5m ago") to see the
> exact date and time.

---

## 5. People

### 5.1 Employees

**Where:** People > Employees. **Permission:** `employees.manage`.

The employee directory is where you maintain your workforce records and see, at
a glance, who has a face enrolled and an RFID card assigned. Four summary cards
across the top show **Total employees**, **Face enrolled**, **RFID assigned**,
and **Inactive**. The table below lists employees (10 per page) with sortable
columns: **Code**, **Employee**, **Department**, **Location**, **Face**, **RFID**,
and **Status**.

**Find an employee.**

- Type in the **Search employees...** box to filter the list.
- Click any column header to sort by it.

**Add an employee.**

1. Click **+ New employee** (top-right).
2. In the side panel, fill in **Employee code** (required), **First name**
   (required), and **Last name** (required).
3. Optionally set **Location**, **Email**, **Department**, **Job title**, and
   **Hire date**.
4. Click **Create employee**. A *"Employee created"* confirmation appears.

**Edit an employee.**

1. Click **Edit** on the employee's row.
2. Change any details. When editing, a **Status** field lets you set the person
   **Active** or **Inactive**.
3. Click **Save changes**.

**Delete an employee.**

1. Click **Delete** on the row.
2. Confirm in the dialog (*"Delete &lt;name&gt; (&lt;code&gt;)? This cannot be
   undone."*).

> **Caution:** Deleting an employee is permanent. To take someone out of daily
> use without losing their record, edit them and set **Status** to **Inactive**
> instead.

> **Note:** The **Face** and **RFID** columns are status indicators only.
> Enrolling a face is done on the [Face enrollment](#52-face-enrollment) pages,
> and assigning a card is done on the [RFID](#82-rfid-readers-and-cards) page.

### 5.2 Face enrollment

**Where:** People > Face Enrollment (guided) and People > Quick Face Register
(simple). **Permission:** `employees.manage`.

Enrolling a face teaches the system to recognize an employee. There are two
modes:

- **Face Enrollment** (guided) - captures each required head pose with automatic
  quality checks. Use this for a complete, high-quality reference set.
- **Quick Face Register** (simple) - registers a face from a few free-form
  photos. Use this to add images quickly.

> **Caution:** Completing the guided **Face Enrollment** flow *replaces* an
> employee's entire existing reference set. **Quick Face Register** instead
> *adds* more images. The page warns you when the selected employee is already
> enrolled.

**Guided Face Enrollment.**

1. Open **People > Face Enrollment**.
2. In **Select employee**, choose the person. Each option shows their code and
   name, with "(re-enroll)" if a face already exists.
3. In the capture card, choose **Webcam** or **Upload** with the toggle.
   - **Webcam:** click **Start camera** and allow the browser's camera prompt. A
     live hint coaches you ("Pose looks good - capture now", "Raise your chin a
     little", "Add more light on your face"). When the hint turns green, click
     **Capture &lt;pose&gt;**.
   - **Upload:** drop or choose a JPEG or PNG of the requested pose.
4. Each capture is checked automatically. Accepted shots show **Accepted** with a
   quality score and advance to the next pose; rejected shots show the reason
   (for example "Too blurry", "Image too dark", "No face detected"). Click
   **Retake** to redo a pose.
5. Track progress in the **Pose checklist** on the right. Click any row to jump
   back to a pose.
6. When all poses are validated, click **Complete enrollment**. A green banner
   confirms success with the embedding count and quality scores.

**Quick Face Register.**

1. Open **People > Quick Face Register**.
2. In **Select employee**, choose the person.
3. Choose **Webcam** or **Upload**, then capture up to five photos from
   different angles. Click **Take photo** for each webcam shot, or add JPEG/PNG
   files. Remove a shot by hovering its thumbnail and clicking the X.
4. Click **Register face**. A green banner confirms how many images were stored
   (images with no clear face are skipped and reported).

> **Tip:** For the most reliable recognition, use the guided flow in good, even
> lighting, and add several angles in the quick flow. Hold still and face the
> camera directly so captures pass the quality checks.

### 5.3 Visitors

**Where:** People > Visitors. **Who:** any signed-in user.

The Visitors page manages the full guest lifecycle through five tabs:
**Dashboard**, **Approvals**, **All visitors**, **On site**, and **Blacklist**.
The active tab is stored in the address bar, so you can bookmark or share a link
to a specific tab. The **Approvals** and **On site** tabs show a live count when
there are pending approvals or visitors on site.

**Register a visitor.**

1. Click **+ Register visitor** (top-right).
2. Under **Visitor details**, enter **First name** and **Last name** (both
   required); optionally add company, phone, email, ID number, and nationality.
3. Under **Visit details**, choose a category and visit type, pick the **Host
   employee**, and add a purpose and description. Set **Visit start** and
   **Visit end**. (If the category is **Contractor**, also set contract dates.)
4. To route the visit through approvals before check-in, tick **Pre-registration
   (requires approval workflow)**.
5. Click **Register visitor**. The view switches to **All visitors**.

**Approve or reject a pre-registered visitor.**

1. Open the **Approvals** tab and click **Review** on the visitor.
2. In the **Approval workflow**, advance the visit with **Manager approve**,
   **Security approve**, and **Final approve** - or click **Approve all stages**
   to complete it at once.
3. To deny, click **Reject**, optionally enter a reason, and confirm.

**Check a visitor in or out.**

- On **All visitors**, click **Check in** for a scheduled visitor or **Check
  out** for one who is checked in.
- The **On site** tab lists everyone currently checked in, each with a **Check
  out** button.

**Enroll a visitor's face.** On a visitor's row (or in their detail panel), click
**Enroll face** and capture a clear, front-facing photo. This lets cameras
recognize the visitor while they are on site.

**Maintain the blacklist / watchlist.**

1. Open the **Blacklist** tab.
2. In **Add to blacklist / watchlist**, enter a **Name** (required), optionally
   an ID number, choose a **Reason** (Blocked, Watchlist, Former employee, or
   Restricted contractor), and add notes.
3. Click **Add to blacklist**. Blocked individuals are flagged on recognition and
   denied access.

> **Caution:** **Remove** on a blacklist entry deletes it immediately, with no
> confirmation. Cancelling a visit (the **Cancel** action) prevents the visitor
> from checking in.

**Review a visitor.** Click **View** (or **Review** on Approvals) to open the
detail panel. From there you can edit visit details, add photos and documents
(PDF/JPG/PNG/WEBP up to 10 MB), set authorized access zones, and read the
activity timeline. The **Code**, **Badge**, and **PIN** chips copy to the
clipboard with one click.

---

## 6. Face recognition

### 6.1 Live Kiosk

**Where:** Face Recognition > Live Kiosk. **Who:** any signed-in user. A
borderless full-screen version is available at the `/kiosk` address for a
dedicated terminal.

The kiosk is a self-service, walk-up check-in station: a person looks at the
camera, the system recognizes their enrolled face, confirms they are live (not a
photo or screen), and records attendance automatically.

**Run a walk-up check-in.**

1. Open **Face Recognition > Live Kiosk** (or load the full-screen `/kiosk`
   address on the terminal).
2. Optionally pick a camera from the dropdown (it defaults to the browser's
   webcam). Leave **Anti-spoof (AI model)** and **Blink / movement** ticked for
   the most secure check-in.
3. Click **Start camera** and allow the browser's camera prompt. The status
   changes to *"Scanning - blink naturally..."*.
4. Have the person look at the camera and blink or move slightly so liveness is
   confirmed.
5. On a match, the face box turns green, the bar reads *"Welcome,
   &lt;name&gt;"*, and the **Live stats** panel shows the person, a
   **Confidence** bar, and the recorded attendance action.
6. Click the red **Stop** button when finished.

**Handling unsuccessful scans.**

- **"Unknown person"** - follow the on-screen hint (move closer, add light, hold
  still). If the person is genuinely not enrolled, register them under
  [Quick Face Register](#52-face-enrollment).
- **A spoof warning** (for example "Printed photo detected", "Mobile screen
  detected") - present a real, live face rather than a photo, screen, or video.
- **"Already checked in (duplicate ignored)"** - no action needed; attendance was
  already recorded.

> **Tip:** For a permanent station, open the full-screen `/kiosk` address so
> there is no sidebar on screen. Recognition needs camera permission; if it is
> denied, an error appears and recognition cannot run.

### 6.2 Liveness and recognition testing

**Where:** Face Recognition > Liveness Test and Face Recognition > Test
Recognition. **Who:** any signed-in user.

These two diagnostic tools confirm the face system is working. They are mainly
for setup and troubleshooting.

**Liveness Test** (anti-spoofing). Confirms the blink and head-movement checks
work. It does **not** record attendance.

1. Open **Face Recognition > Liveness Test**. The four tiles at the top report
   capability (**AI anti-spoof model** Loaded/Not loaded, **Blink detection**,
   **Head movement**, **Spoof types covered**).
2. Click **Start webcam & record** and allow camera access. A red **REC**
   indicator appears and frames are captured automatically.
3. Blink and turn your head slightly until at least 5 frames are captured (the
   button reads **Need N more frames** until then), then click **Verify
   liveness**.
4. Read the result: **Liveness passed** or **Liveness failed**, a **Liveness
   score**, and whether **Blink** and **Head movement** were detected. Expand
   **Raw response** for full detail. Click **Stop** to turn off the camera.

**Test Recognition** (identity check from a photo).

1. Open **Face Recognition > Test Recognition**.
2. Decide whether to keep **Require liveness / anti-spoof** ticked. A single
   still photo will normally fail liveness by design, so untick this if you only
   want to test the identity match.
3. Drop or choose an image in **Camera image** (JPEG or PNG).
4. Click **Run recognition + attendance**. The result shows whether the face
   matched an enrolled person, with a plain-language explanation if it did not
   (for example "No matching enrolled face. Enroll this person under Face
   Enrollment first.").

> **Caution:** Unlike the Liveness Test, **Test Recognition** can record
> attendance for a matched person, because it runs the real recognition
> pipeline.

### 6.3 AI Engine

**Where:** Face Recognition > AI Engine. **Permission:** `recognition.view`.

The AI Engine page is the control room for server-side, real-time recognition
from camera streams. From here you start and stop the engine, watch live
metrics, manage streams, reload the face index, and tune thresholds.

**Start or stop the engine.** The command-center card at the top shows **Engine
operational** (green) or **Engine stopped**. Click **Start engine** to begin
recognition or **Stop engine** to halt it. Four hero stats (**Active streams**,
**Embeddings indexed**, **Attendance events**, **Camera health**) and a
**Recognized / Unknown / Quality rejected** breakdown update live.

Below the command center you can review the **Recognition pipeline** (per-stage
timing, with the slowest stage highlighted), **Live metrics**, a **Live
monitor**, **Performance** (latency SLAs and the **Required performance
metrics** table), and **Infrastructure** cards.

**Manage camera streams.**

1. Click **Manage streams**.
2. Select a **Camera** (its stream URL fills in automatically if one is set) and
   choose a **Protocol** (RTSP, HTTP, WebRTC, or USB / Webcam).
3. Enter the **Stream URL** (or a numeric **Device index** for USB) and click
   **Add stream**.
4. Use **Start** / **Stop** on each row to control a stream, or **Remove** to
   delete one (this stops recognition for that camera and asks for
   confirmation). Click **Reload index** to refresh the face index after
   enrollment changes.

**Tune the engine.** Click **Configuration** to open **Runtime configuration**,
where you can adjust **Recognition threshold**, **Liveness min score**,
**Duplicate window (s)**, and **Max faces / frame**, and toggle **Liveness
enabled** and **Unknown-person alerts**. Click **Save configuration** to apply
without restarting.

> **Note:** The accuracy targets in **Required performance metrics** need
> ground-truth labels. Until you label some events in
> [Unknown Faces](#64-unknown-faces-review), those rows show "No data".

### 6.4 Unknown Faces review

**Where:** Face Recognition > Unknown Faces. **Permission:** `reports.view`.

This page collects faces that cameras captured but could not recognize. Your job
here is to confirm whether each one really was a stranger - your verdict feeds
the system's measured accuracy.

1. Set the date range (top-right; it defaults to the last 7 days). The four
   summary cards (**Flagged faces**, **Alerts sent**, **Cameras involved**,
   **Liveness failures**) update to match.
2. Optionally narrow the list with the camera filter (**All cameras** by
   default) or the **Alerts only** checkbox. Switch between **gallery** and
   **table** views with the toggle.
3. Click a snapshot to open the detail view. Review the image and details
   (time, confidence, liveness, camera, source).
4. In the **Ground truth** panel, click **Truly unknown** if it really was a
   stranger, or **Enrolled person missed** if it was actually an enrolled
   employee the system failed to recognize.
5. A *"Feedback recorded - accuracy metrics updated"* confirmation appears. Use
   the on-screen arrows or the left/right arrow keys to move to the next event.

> **Note:** This page is for accuracy feedback only. It does not enroll people or
> clear alerts. Each event can be labeled once.

---

## 7. Attendance

### 7.1 Attendance records

**Where:** Attendance > Attendance. **Who:** any signed-in user (the export
buttons require `reports.export`).

This page lists daily attendance, captured automatically from recognition and
RFID, with tools to filter, correct, and export it. Five summary cards show
**Records**, **Present**, **Late / early**, **Hours worked**, and **Overtime**
for the visible records. The table (10 rows per page) shows **Date**,
**Employee**, **Check in**, **Check out**, **Hours**, **Overtime**, and
**Status**.

**Filter records.**

- Set the date range with the picker (top-right); it defaults to the last 7
  days.
- Type in **Search employee or code...** to match by name or code.
- Choose a value in the status dropdown (or **All statuses** to clear it). The
  chosen status is saved in the address bar, so you can share a filtered view.

**Record attendance manually.**

1. Click **Record manually** (top-right).
2. Choose the **Employee** (required) and the **Work date** (required, defaults
   to today).
3. Optionally set **Check in** and/or **Check out** times, and a reason in
   **Notes**.
4. Click **Save record**. A *"Attendance recorded"* confirmation appears.

**Export.** Click **CSV**, **Excel**, or **PDF** to download the data.

> **Note:** Exports cover the whole selected date range. The search box and
> status dropdown filter the on-screen list only; they are not applied to the
> exported file.

### 7.2 Anomalies

**Where:** Attendance > Anomalies. **Permission:** `reports.view`.

This page surfaces unusual attendance patterns found by AI-assisted detection
(rule-based checks plus statistical outliers) so you can review and resolve
them.

**Run a scan.** Click **Run detection** to analyze the last 30 days. A green
banner reports how many records were analyzed and anomalies found.

**Filter.** Use the status tabs (**Open**, **Acknowledged**, **Resolved**,
**Dismissed**, **All**), click a severity tile (**critical**, **high**,
**medium**, **low**), or pick a type from the **Most frequent open types** bars
or the **All types** dropdown. Click **Clear filters** to reset.

**Triage an anomaly.** On an open anomaly's row, use the inline buttons:

- **Acknowledge** - mark it as seen (shown while the status is Open).
- **Resolve** - mark it handled.
- **Dismiss** - mark it a false positive.

Click a row to open the **Anomaly details** panel, which shows the anomaly
score, the employee, the supporting evidence, and a timeline; you can act on it
from the panel footer too.

### 7.3 Shifts, policies, holidays, and leave

**Where:** Attendance > Shifts. **Who:** any signed-in user.

This page has four tabs: **Shifts**, **Attendance Policies**, **Holidays**, and
**Leave Requests**. Create and edit forms slide in from the right.

**Create a shift.** On **Shifts**, click **+ New shift**. Enter a **Name**,
choose a **Type** (Fixed, Rotational, Flexible, or Split), set **Start time** and
**End time**, and set **Grace (min)** and **Break (min)**. Optionally choose an
**Attendance policy**. Click **Create shift**.

**Assign a shift.** On a shift's row, click **Assign**, choose an **Employee** and
an **Effective from** date (optionally **Effective to**), and click **Assign**.

**Create an attendance policy.** On **Attendance Policies**, click **+ New
policy**. All thresholds are in minutes: **Grace**, **Break**, **Min work**,
**Max work**, **Overtime after**, and **Half-day**. Tick **Set as default
policy** to make shifts without an explicit policy fall back to it.

**Add a holiday.** On **Holidays**, click **+ Add holiday**, enter a **Name** and
**Date**, and optionally tick **Recurs every year**.

**Approve leave.** On **Leave Requests**, pending rows show **Approve** and
**Reject** buttons. A *"N pending"* badge in the tab header tells you when
approvals are outstanding.

> **Note:** Deleting a shift moves any employees assigned to it onto the default
> schedule. A leave decision (approve/reject) cannot be changed from this page
> once made.

---

## 8. Devices

### 8.1 Cameras

**Where:** Devices > Cameras. **Permission:** `cameras.manage`.

Register and monitor the cameras that feed face recognition. Four fleet tiles
show **Total cameras**, **Online**, **Offline**, and **Recognitions today**; the
first three double as status filters. Cameras appear as tiles showing live
status, health metrics (FPS, latency, CPU, GPU, dropped frames), and the last
time each was seen.

**Register a camera.**

1. Click **+ Register camera**.
2. Under **Identity**, enter a **Camera name** and pick a **Camera type** (RTSP
   IP Camera, IP Camera (HTTP), USB Camera, NVR Channel, CCTV Stream, or Mobile
   Camera).
3. Under **Placement**, choose a **Location** (required) and optionally a
   **Zone**, **Floor**, and **Direction** (Entry / Exit / Both - this controls
   whether the camera records check-ins or check-outs).
4. Under **Video stream**, enter the stream source. The field's label and
   expected format change with the camera type (for example **RTSP stream URL**,
   or **Device index** for USB). Read the hint below it for the exact format.
5. Optionally set **Target FPS**, **Status**, and the **Resolution** width and
   height. Click **Register camera**.

**Test a stream.** On a camera with a stream URL, click **Test**. A banner reports
how many faces were detected and the timing, and whether a face matched an
enrolled person - a quick way to confirm the camera is reachable and working.

**Edit or delete.** Click **Edit** on a tile to change settings, or **Delete**
(then confirm) to remove the camera and stop its recognition.

> **Tip:** The **Online** / **Offline** tiles record their filter in the address
> bar, so a filtered camera view can be bookmarked or linked from a dashboard.

### 8.2 RFID readers and cards

**Where:** Devices > RFID. **Permission:** `rfid.manage`.

Manage badge-based attendance: register physical readers, issue their API
tokens, assign cards to employees, and review tap events. Stat cards show
**Readers**, **Online**, **Offline**, and **Taps today**, across three tabs:
**Readers**, **Cards**, and **Tap events**.

**Register a reader.**

1. Click **Register reader**.
2. Enter a **Name**, pick a **Location**, and optionally set **Direction**
   (**Check in & out**, **Check in only**, or **Check out only**).
3. Click **Register reader**. An amber banner shows the reader's **API token**.

> **Caution:** The API token is shown **once**. Copy it from the *"Reader API
> token - shown once"* banner before clicking **Dismiss** - it cannot be
> retrieved later. Configure the physical reader to post taps using this token.
> Clicking **New token** on a reader generates a fresh token and immediately
> invalidates the old one.

**Assign a card.** On the **Cards** tab, choose the **Employee**, type the
**Card UID** (it is auto-uppercased), optionally add a **Label**, and click
**Assign card**. To revoke a card, find it under **Assigned cards** and click
**Revoke**.

**Test the setup.** Click **Simulate tap**, choose a reader, enter a card UID,
and click **Simulate tap** to confirm the reader-to-card-to-employee mapping
resolves correctly before relying on real taps.

**Review taps.** The **Tap events** tab is a searchable log with the result of
each scan (matched, unknown, or other).

---

## 9. Reports and compliance

### 9.1 Reports and AI security monitoring

**Where:** Reports & Compliance > Reports. **Permission:** `security.monitor`.

This page is the security operations view: it surfaces AI-generated security
alerts - **Unknown person**, **Spoof attempt**, **After-hours access**, and
**Tailgating** - and lets you triage and export them.

The dashboard shows severity tiles (**Open alerts**, **critical**, **high**,
**medium**, **low**, **Resolved**) and a **Last 14 days** trend chart with the
configured detection windows. The alert table has columns **Occurred**,
**Severity**, **Type**, **Alert**, **Source**, and **Status**.

**Triage alerts.**

1. Choose a status tab (**Open**, **Acknowledged**, **Resolved**, **All**).
2. Narrow by clicking a severity tile, choosing a type from **All types**,
   typing in the search box, or setting a date range. Click **Clear filters** to
   reset.
3. Click an alert row to open **Alert details** (title, snapshot, source,
   detection details, timeline).
4. Click **Acknowledge** on an open alert, then **Resolve** to close it out -
   from the row or the detail panel.

**Export.** Apply your filters, then click **CSV**, **Excel**, or **PDF** in the
header. The export honors the active filters.

> **Note:** If AI security monitoring is turned off in the server configuration,
> a banner explains that existing alerts still appear but no new ones are
> generated.

### 9.2 Audit logs

**Where:** Reports & Compliance > Audit Logs. **Permission:** `audit.view`.

The audit log is a complete, read-only record of every sensitive action in the
system - who did what, when, and from where. Summary cards show **Total
events**, **Events today**, **Actors**, and **Action types**. The table columns
are **Time**, **Actor**, **Action**, **Entity**, **Changes**, and **IP
address**; action badges are color-coded (green for create, red for delete,
amber for update, blue for sign-in).

**Search and filter.** Use the **Search action, actor, entity, IP...** box, the
action / entity / actor dropdowns, and the date-range picker. Active filters
appear as removable chips; click **Clear all** to reset.

**Inspect an event.** Click a row to open the **Audit event** panel. For actions
that changed data, it shows a field-by-field before/after comparison - old values
struck through, new values highlighted - plus the IP address and user agent.

**Export.** Click **CSV** or **Excel**; the export respects your current filters.

> **Note:** The audit trail cannot be edited or deleted - it is view, filter, and
> export only.

### 9.3 Privacy and GDPR

**Where:** Reports & Compliance > Privacy & GDPR. **Who:** any signed-in user;
the erasure controls require `employees.manage`.

This page supports data-protection requests. The **Data policy** card summarizes
GDPR mode, retention periods for audit logs and recognition data, the categories
of data collected, the purposes of processing, and a privacy contact.

**Export your own data (Article 15).** In the **My data** card, confirm your
details and click **Download my data (JSON)** to save everything linked to your
account.

**Erase an employee's data (Article 17)** - privileged.

1. In the **Right to erasure** card, review what happens to the data (face
   embeddings are **Deleted**; recognition/attendance history and profile
   details are **Anonymized**).
2. Choose the person in the **Employee** selector and confirm the preview.
3. Click **Erase data**, then **Erase permanently** in the confirmation dialog.

> **Caution:** Erasure cannot be undone. It removes biometric data and
> anonymizes the person's history and personal details, then deactivates the
> record. Attendance totals remain valid for reporting, but the individual can
> no longer be identified.

---

## 10. Administration

### 10.1 Users and permissions

**Where:** Administration > Users & Permissions. **Permission:** `users.manage`
(the **Roles & Permissions** tab also needs `roles.manage`, or Super Admin).

Manage who can sign in to the application and what they are allowed to do.
Remember: **users** are login accounts, separate from **employees**
(see [Key concepts](#2-key-concepts)).

**Create a user.**

1. On the **Users** tab, click **New user**.
2. Enter **Full name**, **Email**, and a **Password** (at least 8 characters).
3. Leave **Active** ticked so the account can sign in.
4. Under **Roles**, tick one or more roles to grant.
5. Click **Create user**.

**Edit a user or reset a password.** Click the user's row, change their details
or roles, and click **Save changes**. To reset the password, type a new one in
**Reset password**; leave it blank to keep the current password.

**Deactivate an account.** Untick **Active** and save. Inactive accounts are kept
but cannot sign in.

> **Note:** You cannot deactivate your own account. Only an existing Super Admin
> can grant the **super_admin** role.

**Manage roles** (Roles & Permissions tab).

1. Click **+ New role**. Enter a lowercase **Name (identifier)** (this cannot be
   changed later) and a **Display label**.
2. Tick the permissions to include. Each permission group has **Select all** /
   **Clear all**.
3. Click **Create role**. To change a role later, select it, adjust its
   permissions, and click **Save changes**.

> **Caution:** **Delete role** is permanent and is disabled while any user still
> has the role - reassign those users first. The built-in **Super Admin** role
> cannot be edited or deleted.

### 10.2 Security and tenancy

**Where:** Administration > Security & Tenancy. **Permission:** `security.view`
(editing directory entries needs the matching `*.manage` permission; scoping to
an organization and creating/deleting organizations require Super Admin).

This page combines a read-only **security posture** dashboard with an editable
**organization directory**. Five tiles at the top count **Organizations**,
**Branches**, **Departments**, **Locations**, and **Employees**.

**Review security posture** (read-only). Four cards summarize how the system is
configured:

- **Authentication** - which methods are enabled (JWT, OAuth2, SAML, LDAP /
  Active Directory).
- **Encryption & secrets** - transport encryption, at-rest cipher, secrets
  driver, and forced HTTPS.
- **Access control** - the authorization model (RBAC) and the configured roles.
- **Tenant isolation** - whether data is partitioned per organization.

**Manage the organization directory.** Use the **Organizations**, **Branches**,
**Departments**, and **Locations** tabs. Click a row or **Edit** to change it, or
the **New** button to add one. Most installations have a single organization;
to rename it, open the **Organizations** tab and click **Edit**.

> **Note (Super Admin):** The **Tenant context** card lets a Super Admin scope
> the whole application to one organization. Pick an organization and click
> **Apply & reload**; every later request is limited to that organization until
> you clear the scope.

> **Caution:** Deletes here are permanent and confirmed. An organization,
> branch, department, or location that still has employees (or, for locations,
> cameras or readers) assigned to it cannot be deleted - move or reassign those
> first.

---

## 11. Permissions reference

The sidebar hides any page you cannot open. This table lists the permission each
page requires. Pages not listed are available to any signed-in user. **Super
Admin** accounts can access everything.

| Page | Sidebar location | Required permission |
|------|------------------|---------------------|
| Dashboard | Overview > Dashboard | none (any user) |
| Employees | People > Employees | `employees.manage` |
| Visitors | People > Visitors | none (any user) |
| Face Enrollment / Quick Face Register | People | `employees.manage` |
| AI Engine | Face Recognition > AI Engine | `recognition.view` |
| Live Kiosk / Liveness Test / Test Recognition | Face Recognition | none (any user) |
| Unknown Faces | Face Recognition > Unknown Faces | `reports.view` |
| Attendance | Attendance > Attendance | none (export needs `reports.export`) |
| Anomalies | Attendance > Anomalies | `reports.view` |
| Shifts | Attendance > Shifts | none (any user) |
| Cameras | Devices > Cameras | `cameras.manage` |
| RFID | Devices > RFID | `rfid.manage` |
| Reports | Reports & Compliance > Reports | `security.monitor` |
| Audit Logs | Reports & Compliance > Audit Logs | `audit.view` |
| Privacy & GDPR | Reports & Compliance > Privacy & GDPR | none (erasure needs `employees.manage`) |
| Users & Permissions | Administration > Users & Permissions | `users.manage` (roles tab: `roles.manage`) |
| Security & Tenancy | Administration > Security & Tenancy | `security.view` |

---

## 12. Troubleshooting

**I cannot see a menu item another user has.** Menus follow permissions. Ask an
administrator to grant you the role that includes the relevant permission (see
the [Permissions reference](#11-permissions-reference)).

**The camera will not start (kiosk, enrollment, or liveness test).** The browser
needs camera permission. Allow it when prompted, and make sure no other
application is using the webcam. If you denied permission earlier, re-enable it
in the browser's site settings and reload.

**Recognition keeps failing as "too blurry" or "too dark".** Improve the
lighting, have the person move closer and hold still, and face the camera
directly. The on-screen hint states the exact problem.

**A real person is reported as a spoof.** Anti-spoofing blocks photos, screens,
and video replays. Present a live face and blink or move naturally. Keep
**Anti-spoof (AI model)** and **Blink / movement** enabled for security.

**Someone is not recognized at the kiosk.** Confirm they are enrolled
(**People > Employees**, the **Face** column shows **Enrolled**). If not, enroll
them under [Face enrollment](#52-face-enrollment). If recognition is generally
weak, re-enroll with clearer, well-lit images.

**Accuracy figures on the AI Engine show "No data".** Accuracy targets need
labeled outcomes. Review and label events under
[Unknown Faces](#64-unknown-faces-review); the metrics update as you record
verdicts.

**An RFID reader stopped working after I generated a new token.** Generating a
token invalidates the previous one. Update the physical reader's configuration
with the new token.

**An exported file contains more rows than the screen shows.** Exports cover the
whole selected date range and ignore the on-screen search and status filters.
Adjust the date range to scope the export.

**The Dashboard numbers seem to lag for a moment.** Live counts arrive over a
real-time connection and briefly fall back to slower polling during a reconnect.
They catch up on their own.

---

## 13. Glossary

**Anti-spoofing / liveness** - checks that confirm a real, live person is in
front of the camera rather than a printed photo, a phone or monitor screen, or a
video replay.

**Embedding** - the numerical "faceprint" derived from an enrolled photo. The
system compares live faces against stored embeddings to identify people.

**Enrollment** - registering an employee's or visitor's face so cameras and the
kiosk can recognize them.

**Employee** - a member of your workforce whose attendance is tracked. Employees
do not sign in.

**User** - a login account for this application, defined by an email, a password,
and one or more roles.

**Role** - a named set of permissions assigned to a user.

**Permission** - a specific capability (for example `cameras.manage`) that gates
a page or action.

**Super Admin** - an account that bypasses all permission checks and can manage
every organization.

**Organization / Branch / Department / Location** - the directory structure that
organizes your workforce and the places where devices are installed.

**Duplicate prevention** - ignoring a repeated recognition of the same person
within a short window so attendance is not double-counted.

**Anomaly** - an unusual attendance pattern flagged by rule-based and statistical
detection for human review.

**Security alert** - an AI-generated event (unknown person, spoof attempt,
after-hours access, or tailgating) raised for security review.
