# Sahyog API Documentation v2.0
## Backend Changes - Business Logic Fixes

**Base URL:** `http://localhost:3000/api/v1` (development)  
**Authentication:** Bearer Token (Clerk JWT)  
**Last Updated:** February 26, 2026

---

## Table of Contents

1. [Breaking Changes Summary](#breaking-changes-summary)
2. [SOS Endpoints](#sos-endpoints)
3. [Task Endpoints](#task-endpoints)
4. [Need Endpoints](#need-endpoints)
5. [Disaster Endpoints](#disaster-endpoints)
6. [Shelter Endpoints](#shelter-endpoints)
7. [Zone Endpoints](#zone-endpoints)
8. [Error Handling](#error-handling)
9. [Socket Events](#socket-events)

---

## Breaking Changes Summary

### 🔴 CRITICAL - Will Break Existing Frontend

| Endpoint | Change | Impact |
|----------|--------|--------|
| `PATCH /sos/:id/status` | Requires `resolution_proof` for volunteers | Volunteers cannot resolve SOS without photos |
| `PATCH /needs/:id/resolve` | Requires `resolution_proof` for volunteers | Volunteers cannot resolve needs without photos |
| `PATCH /tasks/:id/status` | New validations (skills, distance, workload) | Task acceptance restricted |
| `POST /tasks/:id/vote-completion` | Cannot vote on own tasks | Self-voting blocked |
| `POST /disasters/:id/resolve` | Role restriction + active items check | Only coordinators/admins, no active tasks/SOS |
| `POST /shelters/:id/checkin` | Capacity validation | Cannot exceed shelter capacity |
| `DELETE /disasters/:id/relief-zones/:zoneId` | Active assignment check | Cannot delete zones with active items |

---

## SOS Endpoints

### 1. Update SOS Status

**Endpoint:** `PATCH /sos/:id/status`

**Authentication:** Required

**Request Body:**
```json
{
  "status": "resolved",
  "resolution_proof": ["https://storage.com/image1.jpg", "https://storage.com/image2.jpg"],
  "resolution_notes": "Provided first aid and transported to hospital"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | One of: `triggered`, `acknowledged`, `resolved`, `cancelled` |
| `resolution_proof` | array | Conditional | Required for volunteers resolving SOS. Optional for coordinators/admins. Array of image URLs. |
| `resolution_notes` | string | No | Text description of resolution |

**Authorization Rules:**

| Action | Who Can Perform | Requirements |
|--------|-----------------|--------------|
| `acknowledged` | Any authenticated user | Only if not already acknowledged by someone else |
| `resolved` | Coordinator/Admin | No proof required (can override) |
| `resolved` | Volunteer who acknowledged | **Must provide `resolution_proof`** |
| `cancelled` | Reporter or Admin | Only the person who created the SOS |

**Success Response (200):**
```json
{
  "id": "uuid",
  "status": "resolved",
  "resolution_proof": ["url1.jpg", "url2.jpg"],
  "resolution_notes": "Provided first aid...",
  "resolved_at": "2026-02-26T10:30:00Z",
  "acknowledged_by": "uuid",
  "acknowledged_at": "2026-02-26T10:00:00Z"
}
```

**Error Responses:**

```json
// 403 - Volunteer without proof
{
  "message": "Resolution requires photo/video proof. Upload proof and try again."
}

// 403 - Not authorized
{
  "message": "Only coordinators, admins, or the assigned responder can resolve an SOS"
}

// 403 - Already being handled
{
  "message": "SOS is already being handled by another responder"
}

// 403 - Reporter restrictions
{
  "message": "You can only cancel your own SOS reports"
}
```

**Frontend Implementation:**
```javascript
// React/Vue Example
async function resolveSOS(sosId, proofImages, notes) {
  const response = await fetch(`/api/v1/sos/${sosId}/status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${clerkToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'resolved',
      resolution_proof: proofImages,  // REQUIRED for volunteers
      resolution_notes: notes
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    if (response.status === 403 && error.message.includes('proof')) {
      // Show image upload requirement
      alert('Please upload at least one photo as proof of resolution');
    }
  }
}
```

---

## Task Endpoints

### 1. Create Task

**Endpoint:** `POST /tasks`

**Authentication:** Required (Volunteer, Coordinator, Admin)

**Request Body:**
```json
{
  "type": "medical",
  "title": "Provide first aid at evacuation center",
  "description": "Multiple people need basic medical attention",
  "need_id": "uuid",
  "disaster_id": "uuid",
  "zone_id": "uuid",
  "volunteer_id": "uuid",
  "sosId": "uuid",
  "meeting_point": {
    "lat": 19.0760,
    "lng": 72.8777
  }
}
```

**Validation:** All foreign keys (`need_id`, `disaster_id`, `zone_id`, `volunteer_id`, `sosId`) are validated to exist.

**Error Response:**
```json
{
  "message": "Referenced need not found"
}
```

---

### 2. Update Task Status

**Endpoint:** `PATCH /tasks/:id/status`

**Authentication:** Required

**Request Body:**
```json
{
  "status": "accepted",
  "persons_helped": 5,
  "proof_images": ["url1.jpg", "url2.jpg"]
}
```

**Status Values:**
- `pending` → `accepted` (volunteer accepts task)
- `accepted` → `in_progress` (volunteer starts work)
- `in_progress` → `completed` (volunteer finishes work)

**Volunteer Acceptance Validation:**

When a volunteer accepts a task (`status: "accepted"`), the backend validates:

1. **Skills Check:**
   - Critical task types: `medical`, `rescue`, `fire`, `evacuation`
   - Volunteer must have matching skill in their profile

2. **Proximity Check:**
   - Volunteer must be within 50km of task location
   - Calculated from volunteer's `current_location`

3. **Workload Check:**
   - Maximum 3 active tasks per volunteer
   - Active = `pending`, `accepted`, or `in_progress`

**Error Responses:**

```json
// 403 - Skills mismatch
{
  "message": "This medical task requires specific training. Please contact a coordinator.",
  "required_training": "medical",
  "your_skills": ["general", "transport"]
}

// 403 - Too far away
{
  "message": "You are too far from this task location (75km away). Maximum distance is 50km.",
  "distance_km": 75,
  "max_distance_km": 50
}

// 403 - Too many tasks
{
  "message": "You have reached the maximum of 3 active tasks. Complete existing tasks before accepting new ones.",
  "active_tasks": 3,
  "max_tasks": 3
}
```

**Frontend Implementation:**
```javascript
// Show validation warnings before accepting
async function acceptTask(taskId) {
  // Check if task requires special skills
  if (['medical', 'rescue', 'fire', 'evacuation'].includes(task.type)) {
    showWarning(`This task requires ${task.type} training`);
  }
  
  // Check distance
  const distance = calculateDistance(userLocation, task.location);
  if (distance > 50) {
    showError(`You are ${distance}km away. Maximum allowed: 50km`);
    return;
  }
  
  // Check active task count
  if (user.activeTasks >= 3) {
    showError(`You have ${user.activeTasks}/3 active tasks. Complete one first.`);
    return;
  }
  
  // Proceed with acceptance
  const response = await fetch(`/api/v1/tasks/${taskId}/status`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ status: 'accepted' })
  });
}
```

---

### 3. Vote on Task Completion

**Endpoint:** `POST /tasks/:id/vote-completion`

**Authentication:** Required (Volunteer, Coordinator, Admin)

**Request Body:**
```json
{
  "vote": "completed",
  "note": "Verified the work was done properly"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vote` | string | Yes | `completed` or `rejected` |
| `note` | string | No | Optional explanation |

**Restrictions:**
- ❌ Cannot vote on your own task
- ✅ Can only vote `completed` on tasks already marked `completed` by the volunteer
- ✅ Can vote `rejected` on any task

**Error Responses:**

```json
// 403 - Self-voting
{
  "message": "You cannot vote on completion of your own task. Other volunteers or coordinators must verify your work."
}

// 400 - Wrong status
{
  "message": "Can only vote to confirm completion on tasks marked as completed by the volunteer",
  "current_status": "in_progress"
}
```

**Frontend Implementation:**
```javascript
// Hide vote buttons for own tasks
function TaskVoting({ task, currentUser }) {
  if (task.volunteer_id === currentUser.id) {
    return (
      <Alert>
        Other volunteers or coordinators must verify your work
      </Alert>
    );
  }
  
  if (task.status !== 'completed') {
    return (
      <Tooltip title="Task must be marked complete by volunteer first">
        <Button disabled>Vote Complete</Button>
      </Tooltip>
    );
  }
  
  return (
    <>
      <Button onClick={() => vote('completed')}>Confirm Complete</Button>
      <Button onClick={() => vote('rejected')}>Reject</Button>
    </>
  );
}
```

---

## Need Endpoints

### 1. Resolve Need

**Endpoint:** `PATCH /needs/:id/resolve`

**Authentication:** Required

**Request Body:**
```json
{
  "resolution_proof": ["https://storage.com/proof1.jpg"],
  "resolution_notes": "Delivered food and water supplies"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolution_proof` | array | Conditional | Required for volunteers. Optional for coordinators/admins. |
| `resolution_notes` | string | No | Resolution description |

**Authorization:**
- Assigned volunteer can resolve (with proof)
- Coordinator/Admin can resolve (proof optional)
- Others cannot resolve

**Error Response:**
```json
// 403 - Not assigned
{
  "message": "Only the assigned volunteer, coordinator, or admin can resolve this need"
}

// 403 - Missing proof
{
  "message": "Resolution requires photo/video proof of fulfillment. Please upload proof and try again."
}
```

---

## Disaster Endpoints

### 1. Resolve Disaster

**Endpoint:** `POST /disasters/:id/resolve`

**Authentication:** Required (Coordinator, Admin only)

**Authorization:**
- Only users with `coordinator` or `admin` role
- Cannot resolve if active tasks or SOS alerts exist

**Error Responses:**

```json
// 403 - Not authorized
{
  "message": "Only administrators or coordinators can resolve disasters"
}

// 400 - Active items exist
{
  "message": "Cannot resolve disaster with active tasks or SOS alerts",
  "active_tasks": 5,
  "active_sos": 2
}
```

**Frontend Implementation:**
```javascript
function DisasterResolution({ disaster, userRole }) {
  const canResolve = ['coordinator', 'admin'].includes(userRole);
  const hasActiveItems = disaster.active_tasks > 0 || disaster.active_sos > 0;
  
  return (
    <>
      {canResolve && hasActiveItems && (
        <Alert severity="warning">
          Cannot resolve: {disaster.active_tasks} active tasks, {disaster.active_sos} active SOS
        </Alert>
      )}
      <Button disabled={!canResolve || hasActiveItems}>
        Resolve Disaster
      </Button>
    </>
  );
}
```

---

## Shelter Endpoints

### 1. Check In to Shelter

**Endpoint:** `POST /shelters/:id/checkin`

**Authentication:** Required

**Request Body:**
```json
{
  "count": 5
}
```

**Validation:**
- Cannot exceed shelter capacity
- Returns detailed capacity information on error

**Error Response:**
```json
// 400 - Over capacity
{
  "message": "Check-in would exceed shelter capacity",
  "shelter_name": "Relief Center A",
  "capacity": 100,
  "current_occupancy": 95,
  "available_space": 5,
  "requested_checkin": 10
}
```

**Frontend Implementation:**
```javascript
function ShelterCheckIn({ shelter }) {
  const percentage = (shelter.current_occupancy / shelter.capacity) * 100;
  
  return (
    <>
      <CapacityBar 
        current={shelter.current_occupancy} 
        capacity={shelter.capacity}
        percentage={percentage}
      />
      
      {percentage >= 90 && (
        <Alert severity="warning">
          Warning: Shelter at {percentage}% capacity
        </Alert>
      )}
      
      <CheckInForm 
        maxAllowed={shelter.capacity - shelter.current_occupancy}
      />
    </>
  );
}
```

---

## Zone Endpoints

### 1. Delete Zone

**Endpoint:** `DELETE /disasters/:id/relief-zones/:zoneId`

**Authentication:** Required (Admin)

**Validation:**
- Cannot delete zone with active tasks, volunteers, coordinators, or resources

**Error Response:**
```json
// 400 - Active assignments
{
  "message": "Cannot delete zone with active assignments. Reassign or complete all activities first.",
  "active_tasks": 5,
  "active_volunteers": 12,
  "active_coordinators": 2,
  "deployed_resources": 8
}
```

**Frontend Implementation:**
```javascript
function ZoneManagement({ zone }) {
  const totalActive = zone.active_tasks + zone.active_volunteers + 
                     zone.active_coordinators + zone.deployed_resources;
  
  return (
    <>
      <AssignmentStats zone={zone} />
      
      {totalActive > 0 && (
        <Alert severity="warning">
          Cannot delete: {totalActive} active assignments
        </Alert>
      )}
      
      <Button 
        onClick={deleteZone}
        disabled={totalActive > 0}
      >
        Delete Zone
      </Button>
    </>
  );
}
```

---

## Error Handling

### Standard Error Response Format

```json
{
  "message": "Human-readable error message",
  "details": {} // Additional context (optional)
}
```

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Bad Request | Validation failed - check request body |
| 403 | Forbidden | Authorization failed - check permissions |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Backend error - retry or contact support |

### Common Error Patterns

```javascript
// Frontend error handler
async function apiCall(url, options) {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json();
      
      switch (response.status) {
        case 403:
          if (error.message.includes('proof')) {
            // Show image upload dialog
            showImageUploadRequired();
          } else if (error.message.includes('distance')) {
            // Show distance warning
            showDistanceWarning(error.distance_km, error.max_distance_km);
          } else if (error.message.includes('maximum')) {
            // Show workload warning
            showWorkloadWarning(error.active_tasks, error.max_tasks);
          }
          break;
          
        case 400:
          if (error.active_tasks !== undefined) {
            // Disaster has active items
            showActiveItemsWarning(error);
          } else if (error.available_space !== undefined) {
            // Shelter over capacity
            showCapacityWarning(error);
          }
          break;
      }
      
      throw new Error(error.message);
    }
    
    return response.json();
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}
```

---

## Socket Events

### New Events

#### `task_completed_sos_pending`
Emitted when a task is completed but linked SOS requires manual resolution.

```javascript
socket.on('task_completed_sos_pending', (data) => {
  console.log(data);
  // {
  //   task_id: "uuid",
  //   sos_id: "uuid",
  //   message: "Task completed. SOS requires coordinator review for resolution."
  // }
  
  showNotification(data.message);
  // Update UI to show SOS still needs resolution
});
```

### Existing Events (Unchanged)

- `new_sos_alert` - New SOS created
- `sos_resolved` - SOS resolved
- `volunteer_location_update` - Volunteer location changed

---

## Migration Checklist

### Volunteer App
- [ ] Add image upload for SOS resolution
- [ ] Add image upload for need resolution
- [ ] Add skill badges to task display
- [ ] Add distance calculator to task list
- [ ] Add active task counter
- [ ] Hide self-voting buttons
- [ ] Add shelter capacity indicators

### Coordinator Dashboard
- [ ] Add SOS proof viewer
- [ ] Add disaster resolution restrictions
- [ ] Add zone deletion protection
- [ ] Add task validation displays

### Admin Panel
- [ ] Add active items check for disaster resolution
- [ ] Add zone assignment breakdown

---

## Support

For questions or issues:
1. Check this documentation
2. Review the FRONTEND_IMPACT_ASSESSMENT.md
3. Contact backend team
