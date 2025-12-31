# Manual Testing Guide: Entry Draft Autosave

## Prerequisites

1. Dev server running: `npm run dev`
2. Database seeded: `npm run seed:fresh`
3. Browser with DevTools (to inspect localStorage)

## Test Scenarios

### Scenario 1: Draft Save and Restore

**Steps:**
1. Login as a student (alice@test.com / password)
2. Navigate to a classroom → Today tab
3. Open browser DevTools → Application/Storage → Local Storage
4. Start typing in the "What did you do today?" textarea:
   ```
   Today I worked on my algebra homework and learned about quadratic equations.
   ```
5. Wait 500ms for debounce
6. Check localStorage for key: `pika_entry_draft_classroom-{id}_2025-01-15`
   - Should contain your text
   - Should have `savedAt` timestamp

**Expected Result:**
✅ Draft appears in localStorage after 500ms
✅ Draft updates on each keystroke (debounced)

7. **Close the tab** (or navigate away)
8. **Reopen** the classroom → Today tab
9. Look for blue toast message: "Draft restored from auto-save"
10. Textarea should contain your draft text

**Expected Result:**
✅ Toast shows "Draft restored from auto-save"
✅ Textarea contains draft text
✅ Toast disappears after 3 seconds

---

### Scenario 2: Draft Clear on Submit

**Steps:**
1. Continue from Scenario 1 (draft exists)
2. Click "Save" button
3. Wait for green success message: "Entry saved!"
4. Check localStorage
5. Reload the page

**Expected Result:**
✅ Entry submits successfully
✅ Draft is cleared from localStorage
✅ No "Draft restored" toast on reload
✅ Textarea shows saved entry text

---

### Scenario 3: Draft vs Server Entry (Newer Draft Wins)

**Setup:**
1. Submit an entry via API or UI
2. Type new text (creates draft newer than server entry)
3. Reload page

**Expected Result:**
✅ Draft text appears (not server entry)
✅ "Draft restored from auto-save" toast shows

---

### Scenario 4: Draft vs Server Entry (Newer Server Wins)

**Setup:**
1. Create a draft in localStorage manually:
   ```js
   localStorage.setItem(
     'pika_entry_draft_classroom-123_2025-01-15',
     JSON.stringify({
       classroomId: 'classroom-123',
       date: '2025-01-15',
       text: 'Old draft',
       savedAt: Date.now() - 3600000 // 1 hour ago
     })
   )
   ```
2. Submit an entry via UI (creates newer server entry)
3. Reload page

**Expected Result:**
✅ Server entry appears (not draft)
✅ No "Draft restored" toast

---

### Scenario 5: Multiple Classrooms (Scoping)

**Steps:**
1. Student enrolled in 2+ classrooms
2. Create draft in Classroom A
3. Navigate to Classroom B
4. Type different entry
5. Navigate back to Classroom A
6. Check localStorage

**Expected Result:**
✅ Each classroom has separate draft key
✅ Classroom A draft still exists
✅ Classroom B draft exists separately
✅ Correct draft loads for each classroom

---

### Scenario 6: Network Failure Recovery

**Steps:**
1. Open browser DevTools → Network tab
2. Type entry text
3. Set Network to "Offline"
4. Click "Save"
5. Should see error (network failure)
6. Set Network back to "Online"
7. Check localStorage - draft still exists
8. Click "Save" again

**Expected Result:**
✅ Draft persists through network failure
✅ Can retry submit successfully
✅ Draft cleared after successful submit

---

## Edge Cases

### Empty Entry
- Type text → delete all text
- Draft should still save empty string
- Reload → empty textarea

### Very Long Entry
- Type 5000+ character entry
- Draft should save successfully
- Reload → full text restored

### localStorage Quota Exceeded
- Fill localStorage to quota limit
- Try to save draft
- Should fail gracefully (console.error logged)
- No app crash

---

## Verification Checklist

- [ ] Draft saves after 500ms debounce
- [ ] Draft restores on page reload
- [ ] "Draft restored" toast appears
- [ ] Draft clears on successful submit
- [ ] Newer draft takes precedence over server entry
- [ ] Newer server entry takes precedence over draft
- [ ] Each classroom has separate draft
- [ ] Draft persists through network failures
- [ ] No errors in console (except intentional ones)

---

## Developer Tools

### Inspect Draft Data

```js
// In browser console
const key = 'pika_entry_draft_classroom-123_2025-01-15'
const draft = JSON.parse(localStorage.getItem(key))
console.log(draft)
// {
//   classroomId: "classroom-123",
//   date: "2025-01-15",
//   text: "My entry text...",
//   savedAt: 1735920000000
// }
```

### Clear All Drafts

```js
// In browser console
Object.keys(localStorage)
  .filter(k => k.startsWith('pika_entry_draft'))
  .forEach(k => localStorage.removeItem(k))
```

### Simulate Old Draft

```js
localStorage.setItem(
  'pika_entry_draft_classroom-123_2025-01-15',
  JSON.stringify({
    classroomId: 'classroom-123',
    date: '2025-01-15',
    text: 'Draft from 2 hours ago',
    savedAt: Date.now() - 7200000
  })
)
```
