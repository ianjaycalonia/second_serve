document.addEventListener('DOMContentLoaded', function() {
  // Initialize the calendar
  initCalendar();
  
  // Initialize event listeners
  initEventListeners();
});

function initCalendar() {
  // Check if FullCalendar is available
  if (typeof FullCalendar === 'undefined') {
    console.error('FullCalendar is not loaded');
    return;
  }

  // Initialize the calendar
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) {
    console.error('Calendar element not found');
    return;
  }

  // Create the calendar instance
  window.calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    selectable: true,
    selectMirror: true,
    dayMaxEvents: true,
    events: function(fetchInfo, successCallback, failureCallback) {
      // This function will be called when the calendar needs events
      // You can implement your own event fetching logic here
      successCallback([]);
    },
    dateClick: function(info) {
      // Handle date click to create a new event
      openNewEventModal(info.date);
    },
    eventClick: function(info) {
      // Handle event click to view/edit an existing event
      openEditEventModal(info.event);
    },
    eventDidMount: function(info) {
      // Add custom styling to events based on their type
      const eventType = info.event.extendedProps.type || 'default';
      info.el.classList.add(`fc-event-${eventType}`);
    }
  });

  // Render the calendar
  window.calendar.render();
}

function initEventListeners() {
  // New Event Button
  const newEventBtn = document.getElementById('newEventBtn');
  if (newEventBtn) {
    newEventBtn.addEventListener('click', function() {
      openNewEventModal();
    });
  }

  // Edit Event Button
  const editEventBtn = document.getElementById('editEventBtn');
  if (editEventBtn) {
    editEventBtn.addEventListener('click', function() {
      const selectedEvent = getSelectedEvent();
      if (selectedEvent) {
        openEditEventModal(selectedEvent);
      }
    });
  }

  // Refresh Button
  const refreshBtn = document.getElementById('refreshCalBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      if (window.calendar) {
        window.calendar.refetchEvents();
        showFeedback('Calendar refreshed', 'success');
      }
    });
  }

  // Save Event Form
  const eventForm = document.getElementById('eventForm');
  if (eventForm) {
    eventForm.addEventListener('submit', function(e) {
      e.preventDefault();
      saveEvent();
    });
  }

  // Delete Event Button
  const deleteBtn = document.getElementById('deleteEventBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function() {
      const eventId = document.getElementById('evId').value;
      if (eventId) {
        deleteEvent(eventId);
      }
    });
  }
}

function openNewEventModal(date) {
  // Reset the form
  const form = document.getElementById('eventForm');
  if (form) form.reset();
  
  // Set default values
  const evId = document.getElementById('evId');
  if (evId) evId.value = '';
  
  // Set the date if provided
  if (date) {
    const dateInput = document.getElementById('evDate');
    const timeInput = document.getElementById('evStartTime');
    
    if (dateInput) {
      dateInput.value = date.toISOString().split('T')[0];
    }
    
    if (timeInput) {
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      timeInput.value = `${hours}:${minutes}`;
    }
  }
  
  // Show the modal
  const modal = new bootstrap.Modal(document.getElementById('eventModal'));
  modal.show();
  
  // Hide delete button for new events
  const deleteBtn = document.getElementById('deleteEventBtn');
  if (deleteBtn) deleteBtn.style.display = 'none';
}

function openEditEventModal(event) {
  // Populate the form with event data
  const form = document.getElementById('eventForm');
  if (!form) return;
  
  // Reset form
  form.reset();
  
  // Set event ID
  const evId = document.getElementById('evId');
  if (evId) evId.value = event.id;
  
  // Set event title
  const evTitle = document.getElementById('evTitle');
  if (evTitle) evTitle.value = event.title || '';
  
  // Set event type
  const eventType = event.extendedProps.type || 'recipient';
  const evType = document.getElementById('evType');
  if (evType) evType.value = eventType;
  
  // Update UI based on event type
  updateUIForEventType(eventType);
  
  // Set date and time
  const start = event.start ? new Date(event.start) : new Date();
  const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000);
  
  const evDate = document.getElementById('evDate');
  const evStartTime = document.getElementById('evStartTime');
  const evEndTime = document.getElementById('evEndTime');
  
  if (evDate) evDate.value = start.toISOString().split('T')[0];
  if (evStartTime) evStartTime.value = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
  if (evEndTime) evEndTime.value = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;
  
  // Set location and notes
  const evLocation = document.getElementById('evLocation');
  const evNotes = document.getElementById('evNotes');
  
  if (evLocation) evLocation.value = event.extendedProps.location || '';
  if (evNotes) evNotes.value = event.extendedProps.notes || '';
  
  // Set status
  const evStatus = document.getElementById('evStatus');
  if (evStatus) evStatus.value = event.extendedProps.status || 'scheduled';
  
  // Show delete button for existing events
  const deleteBtn = document.getElementById('deleteEventBtn');
  if (deleteBtn) deleteBtn.style.display = 'block';
  
  // Show the modal
  const modal = new bootstrap.Modal(document.getElementById('eventModal'));
  modal.show();
}

function saveEvent() {
  // Collect form data
  const formData = {
    id: document.getElementById('evId').value || null,
    title: document.getElementById('evTitle').value || 'New Event',
    type: document.getElementById('evType').value || 'recipient',
    date: document.getElementById('evDate').value,
    startTime: document.getElementById('evStartTime').value,
    endTime: document.getElementById('evEndTime').value,
    location: document.getElementById('evLocation').value,
    notes: document.getElementById('evNotes').value,
    status: document.getElementById('evStatus').value || 'scheduled'
  };
  
  // Show loading state
  const submitBtn = document.querySelector('#eventForm [type="submit"]');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
  
  // Simulate API call (replace with actual API call)
  setTimeout(() => {
    console.log('Saving event:', formData);
    
    // Reset button state
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    
    // Show success message
    showFeedback('Event saved successfully!', 'success');
    
    // Hide the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('eventModal'));
    if (modal) modal.hide();
    
    // Refresh the calendar
    if (window.calendar) {
      window.calendar.refetchEvents();
    }
  }, 1000);
}

function deleteEvent(eventId) {
  if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
    return;
  }
  
  // Show loading state
  const deleteBtn = document.getElementById('deleteEventBtn');
  const originalBtnText = deleteBtn.innerHTML;
  deleteBtn.disabled = true;
  deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Deleting...';
  
  // Simulate API call (replace with actual API call)
  setTimeout(() => {
    console.log('Deleting event:', eventId);
    
    // Reset button state
    deleteBtn.innerHTML = originalBtnText;
    deleteBtn.disabled = false;
    
    // Show success message
    showFeedback('Event deleted successfully!', 'success');
    
    // Hide the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('eventModal'));
    if (modal) modal.hide();
    
    // Refresh the calendar
    if (window.calendar) {
      window.calendar.refetchEvents();
    }
  }, 1000);
}

function getSelectedEvent() {
  // Return the currently selected event from the calendar's selected event data
  if (typeof window.getSelectedEventData === 'function') {
    return window.getSelectedEventData();
  }
  return null;
}

function showFeedback(message, type = 'info') {
  const feedbackEl = document.getElementById('calFeedback');
  if (!feedbackEl) return;
  
  feedbackEl.textContent = message;
  feedbackEl.className = `alert alert-${type} p-2 small mb-2`;
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    feedbackEl.textContent = '';
    feedbackEl.className = 'small mb-2';
  }, 3000);
}

function updateUIForEventType(type) {
  // Update the UI based on the selected event type
  const recipientSection = document.getElementById('wrapRecipient');
  const pickupDetails = document.getElementById('wrapPickupDetails');
  
  if (type === 'recipient') {
    if (recipientSection) recipientSection.style.display = 'block';
    if (pickupDetails) {
      pickupDetails.querySelector('.card-header h6').textContent = 'Pickup Details';
      pickupDetails.querySelector('label[for="evLocation"]').textContent = 'Pickup Location';
    }
  } else if (type === 'donor') {
    if (recipientSection) recipientSection.style.display = 'none';
    if (pickupDetails) {
      pickupDetails.querySelector('.card-header h6').textContent = 'Pickup Information';
      pickupDetails.querySelector('label[for="evLocation"]').textContent = 'Pickup Address';
    }
  } else if (type === 'admin') {
    if (recipientSection) recipientSection.style.display = 'none';
    if (pickupDetails) {
      pickupDetails.querySelector('.card-header h6').textContent = 'Event Details';
      pickupDetails.querySelector('label[for="evLocation"]').textContent = 'Location';
    }
  }
}
