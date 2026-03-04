-- Allow dedicated telemetry for exam-mode window/fullscreen exits.
alter table public.test_focus_events
  drop constraint if exists test_focus_events_event_type_check;

alter table public.test_focus_events
  add constraint test_focus_events_event_type_check
  check (event_type in ('away_start', 'away_end', 'route_exit_attempt', 'window_unmaximize_attempt'));
