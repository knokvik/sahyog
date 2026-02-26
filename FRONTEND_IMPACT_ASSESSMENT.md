# Sahyog Platform - Frontend Impact Assessment
## Backend Changes: Critical Business Logic Fixes

**Backend Commit:** `c5e99f8` - "fix: critical business logic flaws and security vulnerabilities"
**Date:** February 26, 2026

---

## Executive Summary

The backend has implemented strict validation and authorization rules that **WILL BREAK** existing frontend functionality if not updated. All frontend components (Web App, Mobile App, Admin Dashboard) require updates to comply with new API requirements.

---

## Critical Breaking Changes

### 1. SOS Resolution Now Requires Proof
**Affected Roles:** Volunteer, Coordinator, Admin

#### API Change
```http
PATCH /api/v1/sos/:id/status
```

#### New Required Parameters
| Parameter | Type | Required For | Description |
|-----------|------|--------------|-------------|
| `status` | string | Always | 'resolved' to close SOS |
| `resolution_proof` | array | Volunteers (required), Coordinators (optional) | Array of image/video URLs |
| `resolution_notes` | string | Optional | Text description of resolution |

#### Frontend Changes Required

**Volunteer App:**
- Add photo/video upload component before SOS resolution
- Show warning: "Photo proof required to resolve SOS"
- Implement multi-image picker with preview
- Disable "Resolve" button until at least 1 image uploaded

**Coordinator Dashboard:**
- Add optional proof upload (can override without proof)
- Add resolution notes text area
- Show proof viewer for SOS resolution review

**Error Handling:**
```javascript
// New error response
{
  "message": "Resolution requires photo/video proof. Upload proof and try again."
}
```

---

### 2. Need Resolution Now Requires Proof
**Affected Roles:** Volunteer, Coordinator, Admin

#### API Change
```http
PATCH /api/v1/needs/:id/resolve
```

#### New Required Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resolution_proof` | array | Yes (volunteers), No (coordinators/admins) | Array of image URLs |
| `resolution_notes` | string | Optional | Resolution description |

#### Frontend Changes Required

**Volunteer App:**
- Add proof upload step before marking need as resolved
- Show requirement message for assigned volunteers
- Coordinator override option visible only to coordinators

**Error Handling:**
```javascript
{
  "message": "Resolution requires photo/video proof of fulfillment. Please upload proof and try again."
}
```

---

### 3. Task Acceptance Validations
**Affected Roles:** Volunteer

#### API Change
```http
PATCH /api/v1/tasks/:id/status
Body: { "status": "accepted" }
```

#### New Validation Rules
1. **Skills Check:** Critical tasks (medical, rescue, fire, evacuation) require matching skills
2. **Proximity Check:** Volunteer must be within 50km of task location
3. **Workload Check:** Maximum 3 active tasks per volunteer

#### Frontend Changes Required

**Volunteer App - Task Detail Screen:**
```javascript
// Show skill requirements
if (['medical', 'rescue', 'fire', 'evacuation'].includes(task.type)) {
  showBadge(`Requires ${task.type} training`, 'warning');
}

// Show distance warning
if (volunteerDistance > 50) {
  showAlert(`You are ${distance}km away. Maximum allowed: 50km`);
  disableAcceptButton();
}

// Show active task count
showBadge(`${activeTasks}/3 active tasks`, activeTasks >= 3 ? 'danger' : 'info');
```

**Error Responses to Handle:**
```javascript
// Skills mismatch
{
  "message": "This medical task requires specific training. Please contact a coordinator.",
  "required_training": "medical",
  "your_skills": ["general", "transport"]
}

// Too far away
{
  "message": "You are too far from this task location (75km away). Maximum distance is 50km.",
  "distance_km": 75,
  "max_distance_km": 50
}

// Too many tasks
{
  "message": "You have reached the maximum of 3 active tasks. Complete existing tasks before accepting new ones.",
  "active_tasks": 3,
  "max_tasks": 3
}
```

---

### 4. Task Voting Restrictions
**Affected Roles:** Volunteer

#### API Change
```http
POST /api/v1/tasks/:id/vote-completion
```

#### New Restrictions
- Volunteers **CANNOT** vote on their own tasks
- Can only vote "completed" on tasks already marked "completed" by volunteer

#### Frontend Changes Required

**Volunteer App:**
```javascript
// Hide vote buttons on own tasks
if (task.volunteer_id === currentUser.id) {
  hideVoteButtons();
  showMessage("Other volunteers or coordinators must verify your work");
}

// Only show vote options when task.status === 'completed'
if (task.status !== 'completed') {
  disableVoteButton();
  showTooltip("Task must be marked complete by volunteer first");
}
```

**Error Response:**
```javascript
{
  "message": "You cannot vote on completion of your own task. Other volunteers or coordinators must verify your work."
}
```

---

### 5. Disaster Resolution Restrictions
**Affected Roles:** Coordinator, Admin

#### API Change
```http
POST /api/v1/disasters/:id/resolve
```

#### New Restrictions
- Only coordinators and admins can resolve disasters
- Cannot resolve if active tasks or SOS alerts exist

#### Frontend Changes Required

**Admin/Coordinator Dashboard:**
```javascript
// Show resolve button only for coordinators/admins
if (['coordinator', 'admin'].includes(user.role)) {
  showResolveButton();
}

// Check for active items before allowing resolve
if (disaster.active_tasks > 0 || disaster.active_sos > 0) {
  showWarning(`Cannot resolve: ${active_tasks} active tasks, ${active_sos} active SOS`);
  disableResolveButton();
}
```

**Error Response:**
```javascript
{
  "message": "Cannot resolve disaster with active tasks or SOS alerts",
  "active_tasks": 5,
  "active_sos": 2
}
```

---

### 6. Shelter Capacity Validation
**Affected Roles:** Volunteer, Coordinator, Admin

#### API Change
```http
POST /api/v1/shelters/:id/checkin
```

#### New Validation
- Cannot exceed shelter capacity
- Returns detailed capacity information

#### Frontend Changes Required

**All Apps:**
```javascript
// Show capacity bar
showCapacityBar(current, capacity, percentage);

// Warning at 90%
if (percentage >= 90) {
  showAlert(`Warning: Shelter at ${percentage}% capacity`);
}

// Block check-in if over capacity
if (requestedCount > availableSpace) {
  showError(`Only ${availableSpace} spots available`);
}
```

**Error Response:**
```javascript
{
  "message": "Check-in would exceed shelter capacity",
  "shelter_name": "Relief Center A",
  "capacity": 100,
  "current_occupancy": 95,
  "available_space": 5,
  "requested_checkin": 10
}
```

---

### 7. Zone Deletion Protection
**Affected Roles:** Admin

#### API Change
```http
DELETE /api/v1/disasters/:id/relief-zones/:zoneId
```

#### New Validation
- Cannot delete zone with active tasks, volunteers, coordinators, or resources

#### Frontend Changes Required

**Admin Dashboard:**
```javascript
// Show active assignments count
showZoneStats({
  active_tasks: 5,
  active_volunteers: 12,
  active_coordinators: 2,
  deployed_resources: 8
});

// Disable delete if any active assignments
if (totalActive > 0) {
  disableDeleteButton();
  showMessage("Reassign or complete all activities before deleting zone");
}
```

**Error Response:**
```javascript
{
  "message": "Cannot delete zone with active assignments. Reassign or complete all activities first.",
  "active_tasks": 5,
  "active_volunteers": 12,
  "active_coordinators": 2,
  "deployed_resources": 8
}
```

---

### 8. Task Creation Foreign Key Validation
**Affected Roles:** Coordinator, Admin

#### API Change
```http
POST /api/v1/tasks
```

#### New Validation
- Validates `need_id`, `disaster_id`, `zone_id`, `volunteer_id`, `sosId` exist

#### Frontend Changes Required

**Coordinator Dashboard:**
```javascript
// Validate references before submission
// Show 404 errors if referenced items don't exist

// Error responses:
{ "message": "Referenced need not found" }
{ "message": "Referenced disaster not found" }
{ "message": "Referenced zone not found" }
{ "message": "Referenced volunteer not found" }
{ "message": "Referenced SOS alert not found" }
```

---

### 9. SOS Auto-Resolution Removed
**Affected Roles:** All

#### Behavior Change
- Completing a task NO LONGER auto-resolves linked SOS
- SOS stays in "acknowledged" status
- Coordinator must manually resolve with proof

#### Frontend Changes Required

**All Apps:**
```javascript
// Listen for new socket event
socket.on('task_completed_sos_pending', (data) => {
  showNotification(data.message);
  // SOS still needs resolution
});

// Don't show "SOS Resolved" when task completes
// Show "Task Complete - SOS Pending Review" instead
```

---

## Component-by-Component Breakdown

### 1. User/Citizen Side (Public Reporting)

**No Breaking Changes** - Can still:
- Report SOS without authentication
- Report needs
- Report missing persons

**Recommended Enhancements:**
- Add photo upload to SOS reporting
- Add location picker with map

---

### 2. Volunteer Mobile App

**CRITICAL UPDATES REQUIRED:**

| Screen | Changes |
|--------|---------|
| Task List | Show distance to task, skill requirements, active task count |
| Task Detail | Add "Accept" validation with distance/skill checks |
| Task Complete | Add proof photo upload before marking complete |
| SOS Resolution | Add mandatory photo upload for SOS resolution |
| Need Resolution | Add proof upload for assigned needs |
| Shelter Check-in | Show capacity warning, block over-capacity |
| My Tasks | Show 3-task limit indicator |

**New UI Components Needed:**
- Image picker with multi-select
- Distance calculator display
- Skill badge display
- Capacity progress bar

---

### 3. Coordinator Web Dashboard

**CRITICAL UPDATES REQUIRED:**

| Screen | Changes |
|--------|---------|
| Disaster Management | Add active task/SOS check before resolve |
| Zone Management | Show active assignments, block delete if active |
| Task Oversight | Show volunteer distance, skills mismatch warnings |
| SOS Review | Add proof viewer, resolution notes field |
| Need Review | Add proof requirement for resolution |
| Task Voting | Hide vote for task owner, show status-based voting |

**New UI Components Needed:**
- Proof image gallery viewer
- Active assignments counter
- Distance validation display
- Override controls for coordinators

---

### 4. NGO/Organization Portal

**MODERATE UPDATES REQUIRED:**

| Screen | Changes |
|--------|---------|
| Resource Management | No changes (but zone deletion affects resources) |
| Volunteer Assignment | Consider task limits when assigning |
| Task Creation | FK validation errors to handle |

---

### 5. Admin Panel

**CRITICAL UPDATES REQUIRED:**

| Screen | Changes |
|--------|---------|
| Disaster Resolution | Add role check, active items validation |
| Zone Management | Show all active assignments before delete |
| User Management | No changes |
| System Overview | Add capacity warnings, task limit indicators |

---

## Commit Strategy for Frontend

### Recommended Commit Structure

```
feat(frontend): align with backend business logic fixes

BREAKING CHANGE: Frontend must be deployed with backend commit c5e99f8

Changes:
- Add proof upload for SOS resolution (volunteer required, coordinator optional)
- Add proof upload for need resolution
- Add task acceptance validation (skills, 50km proximity, 3-task limit)
- Prevent self-voting on task completion
- Add disaster resolution restrictions (coordinator/admin only)
- Add shelter capacity validation and warnings
- Add zone deletion protection display
- Handle new foreign key validation errors
- Update SOS status flow (no auto-resolution)

Components Updated:
- VolunteerMobile: TaskAcceptance, SOSResolution, NeedResolution, ShelterCheckIn
- CoordinatorDashboard: DisasterMgmt, ZoneMgmt, SOSReview, TaskOversight
- AdminPanel: DisasterResolution, ZoneDeletion
- Shared: ImageUploader, CapacityIndicator, DistanceCalculator

Closes: #[issue-number]
```

### Suggested Frontend Commits (Incremental)

1. **feat(volunteer): add proof upload for SOS and need resolution**
2. **feat(volunteer): add task acceptance validation (skills, distance, workload)**
3. **feat(volunteer): prevent self-voting on task completion**
4. **feat(coordinator): add SOS review with proof viewer**
5. **feat(coordinator): add disaster resolution restrictions**
6. **feat(coordinator): add zone deletion protection UI**
7. **feat(shared): add shelter capacity indicators**
8. **feat(shared): add image upload component**
9. **fix(shared): handle new API validation errors**
10. **feat(shared): update socket event handlers for task completion flow**

---

## Testing Checklist

### Volunteer App
- [ ] Cannot resolve SOS without photo proof
- [ ] Cannot accept medical task without medical skill
- [ ] Cannot accept task >50km away
- [ ] Cannot accept 4th active task
- [ ] Cannot vote on own task completion
- [ ] Shelter shows capacity warning at 90%
- [ ] Shelter blocks check-in over capacity

### Coordinator Dashboard
- [ ] Can resolve SOS without proof (override)
- [ ] Can resolve disaster only with no active items
- [ ] Can delete zone only with no active assignments
- [ ] Can view proof images for SOS resolution
- [ ] Cannot vote on tasks not marked complete

### Admin Panel
- [ ] Can resolve any disaster (if no active items)
- [ ] Can delete zones (if no active assignments)
- [ ] All validation errors display correctly

---

## Migration Timeline

| Phase | Duration | Actions |
|-------|----------|---------|
| **Phase 1** | 1-2 days | Update API service layer, add new parameters |
| **Phase 2** | 2-3 days | Build new UI components (image upload, capacity indicators) |
| **Phase 3** | 2-3 days | Update screens with validation logic |
| **Phase 4** | 1-2 days | Error handling, edge cases |
| **Phase 5** | 1-2 days | Testing, bug fixes |

**Total Estimated Time: 7-12 days for full frontend update**

---

## Questions?

Contact the backend team regarding:
- Image upload endpoint specifications
- Maximum image sizes and formats
- Socket event documentation
- Rate limiting policies
