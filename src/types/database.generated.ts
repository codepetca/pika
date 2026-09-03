export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      announcement_reads: {
        Row: {
          announcement_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          classroom_id: string
          content: string
          created_at: string
          created_by: string
          id: string
          scheduled_for: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          classroom_id: string
          content: string
          created_at?: string
          created_by: string
          id?: string
          scheduled_for?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          scheduled_for?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_drafts: {
        Row: {
          assessment_id: string
          assessment_type: string
          classroom_id: string
          content: Json
          created_at: string
          created_by: string
          id: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          assessment_id: string
          assessment_type: string
          classroom_id: string
          content?: Json
          created_at?: string
          created_by: string
          id?: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          assessment_id?: string
          assessment_type?: string
          classroom_id?: string
          content?: Json
          created_at?: string
          created_by?: string
          id?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_drafts_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_drafts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_ai_grading_run_items: {
        Row: {
          assignment_doc_id: string | null
          assignment_doc_updated_at: string | null
          assignment_id: string
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          next_retry_at: string | null
          queue_position: number
          run_id: string
          skip_reason: string | null
          started_at: string | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          assignment_doc_id?: string | null
          assignment_doc_updated_at?: string | null
          assignment_id: string
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_retry_at?: string | null
          queue_position?: number
          run_id: string
          skip_reason?: string | null
          started_at?: string | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          assignment_doc_id?: string | null
          assignment_doc_updated_at?: string | null
          assignment_id?: string
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_retry_at?: string | null
          queue_position?: number
          run_id?: string
          skip_reason?: string | null
          started_at?: string | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_ai_grading_run_items_assignment_doc_id_fkey"
            columns: ["assignment_doc_id"]
            isOneToOne: false
            referencedRelation: "assignment_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_ai_grading_run_items_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_ai_grading_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assignment_ai_grading_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_ai_grading_run_items_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_ai_grading_runs: {
        Row: {
          assignment_id: string
          completed_at: string | null
          completed_count: number
          created_at: string
          error_samples_json: Json
          failed_count: number
          gradable_count: number
          gradex_last_polled_at: string | null
          gradex_run_id: string | null
          gradex_status: string | null
          gradex_submitted_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          model: string | null
          processed_count: number
          requested_count: number
          requested_student_ids_json: Json
          selection_hash: string
          skipped_empty_count: number
          skipped_missing_count: number
          started_at: string | null
          status: string
          triggered_by: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          error_samples_json?: Json
          failed_count?: number
          gradable_count?: number
          gradex_last_polled_at?: string | null
          gradex_run_id?: string | null
          gradex_status?: string | null
          gradex_submitted_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model?: string | null
          processed_count?: number
          requested_count?: number
          requested_student_ids_json?: Json
          selection_hash: string
          skipped_empty_count?: number
          skipped_missing_count?: number
          started_at?: string | null
          status?: string
          triggered_by: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          error_samples_json?: Json
          failed_count?: number
          gradable_count?: number
          gradex_last_polled_at?: string | null
          gradex_run_id?: string | null
          gradex_status?: string | null
          gradex_submitted_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model?: string | null
          processed_count?: number
          requested_count?: number
          requested_student_ids_json?: Json
          selection_hash?: string
          skipped_empty_count?: number
          skipped_missing_count?: number
          started_at?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_ai_grading_runs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_ai_grading_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_artifact_storage_cleanup: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_artifact_storage_cleanup_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_doc_history: {
        Row: {
          assignment_doc_id: string
          char_count: number
          created_at: string
          id: string
          keystroke_count: number | null
          paste_word_count: number | null
          patch: Json | null
          snapshot: Json | null
          trigger: string
          word_count: number
        }
        Insert: {
          assignment_doc_id: string
          char_count: number
          created_at?: string
          id?: string
          keystroke_count?: number | null
          paste_word_count?: number | null
          patch?: Json | null
          snapshot?: Json | null
          trigger: string
          word_count: number
        }
        Update: {
          assignment_doc_id?: string
          char_count?: number
          created_at?: string
          id?: string
          keystroke_count?: number | null
          paste_word_count?: number | null
          patch?: Json | null
          snapshot?: Json | null
          trigger?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignment_doc_history_assignment_doc_id_fkey"
            columns: ["assignment_doc_id"]
            isOneToOne: false
            referencedRelation: "assignment_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_doc_save_operations: {
        Row: {
          assignment_doc_id: string
          completed_at: string
          content_sha256: string
          document_updated_at: string
          id: string
          keystroke_count: number
          metric_session_id: string
          paste_word_count: number
          save_sequence: number
          save_session_id: string
        }
        Insert: {
          assignment_doc_id: string
          completed_at?: string
          content_sha256: string
          document_updated_at: string
          id?: string
          keystroke_count: number
          metric_session_id: string
          paste_word_count: number
          save_sequence: number
          save_session_id: string
        }
        Update: {
          assignment_doc_id?: string
          completed_at?: string
          content_sha256?: string
          document_updated_at?: string
          id?: string
          keystroke_count?: number
          metric_session_id?: string
          paste_word_count?: number
          save_sequence?: number
          save_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_doc_save_operations_assignment_doc_id_fkey"
            columns: ["assignment_doc_id"]
            isOneToOne: false
            referencedRelation: "assignment_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_docs: {
        Row: {
          ai_feedback_model: string | null
          ai_feedback_suggested_at: string | null
          ai_feedback_suggestion: string | null
          ai_grading_provenance: Json | null
          ai_grading_review: Json | null
          assignment_id: string
          authenticity_flags: Json | null
          authenticity_score: number | null
          content: Json
          content_legacy: string
          created_at: string
          feedback: string | null
          feedback_returned_at: string | null
          github_username: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          is_submitted: boolean
          repo_url: string | null
          returned_at: string | null
          save_sequence: number | null
          save_session_id: string | null
          score_completion: number | null
          score_thinking: number | null
          score_workflow: number | null
          student_id: string
          submitted_at: string | null
          teacher_cleared_at: string | null
          teacher_feedback_draft: string | null
          teacher_feedback_draft_updated_at: string | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          ai_feedback_model?: string | null
          ai_feedback_suggested_at?: string | null
          ai_feedback_suggestion?: string | null
          ai_grading_provenance?: Json | null
          ai_grading_review?: Json | null
          assignment_id: string
          authenticity_flags?: Json | null
          authenticity_score?: number | null
          content?: Json
          content_legacy?: string
          created_at?: string
          feedback?: string | null
          feedback_returned_at?: string | null
          github_username?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          is_submitted?: boolean
          repo_url?: string | null
          returned_at?: string | null
          save_sequence?: number | null
          save_session_id?: string | null
          score_completion?: number | null
          score_thinking?: number | null
          score_workflow?: number | null
          student_id: string
          submitted_at?: string | null
          teacher_cleared_at?: string | null
          teacher_feedback_draft?: string | null
          teacher_feedback_draft_updated_at?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          ai_feedback_model?: string | null
          ai_feedback_suggested_at?: string | null
          ai_feedback_suggestion?: string | null
          ai_grading_provenance?: Json | null
          ai_grading_review?: Json | null
          assignment_id?: string
          authenticity_flags?: Json | null
          authenticity_score?: number | null
          content?: Json
          content_legacy?: string
          created_at?: string
          feedback?: string | null
          feedback_returned_at?: string | null
          github_username?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          is_submitted?: boolean
          repo_url?: string | null
          returned_at?: string | null
          save_sequence?: number | null
          save_session_id?: string | null
          score_completion?: number | null
          score_thinking?: number | null
          score_workflow?: number | null
          student_id?: string
          submitted_at?: string | null
          teacher_cleared_at?: string | null
          teacher_feedback_draft?: string | null
          teacher_feedback_draft_updated_at?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_docs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_docs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_feedback_entries: {
        Row: {
          assignment_id: string
          author_type: string
          body: string
          created_at: string
          created_by: string | null
          entry_kind: string
          id: string
          returned_at: string
          student_id: string
        }
        Insert: {
          assignment_id: string
          author_type: string
          body: string
          created_at?: string
          created_by?: string | null
          entry_kind: string
          id?: string
          returned_at?: string
          student_id: string
        }
        Update: {
          assignment_id?: string
          author_type?: string
          body?: string
          created_at?: string
          created_by?: string | null
          entry_kind?: string
          id?: string
          returned_at?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_feedback_entries_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_feedback_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_feedback_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_repo_review_results: {
        Row: {
          active_days: number
          assignment_id: string
          burst_ratio: number
          commit_count: number
          confidence: number
          created_at: string
          draft_feedback: string | null
          draft_score_completion: number | null
          draft_score_thinking: number | null
          draft_score_workflow: number | null
          evidence_json: Json
          github_login: string | null
          grading_model: string | null
          grading_provenance: Json | null
          id: string
          iteration_score: number
          relative_contribution_share: number
          run_id: string
          semantic_breakdown_json: Json
          session_count: number
          spread_score: number
          student_id: string
          timeline_json: Json
          weighted_contribution: number
        }
        Insert: {
          active_days?: number
          assignment_id: string
          burst_ratio?: number
          commit_count?: number
          confidence?: number
          created_at?: string
          draft_feedback?: string | null
          draft_score_completion?: number | null
          draft_score_thinking?: number | null
          draft_score_workflow?: number | null
          evidence_json?: Json
          github_login?: string | null
          grading_model?: string | null
          grading_provenance?: Json | null
          id?: string
          iteration_score?: number
          relative_contribution_share?: number
          run_id: string
          semantic_breakdown_json?: Json
          session_count?: number
          spread_score?: number
          student_id: string
          timeline_json?: Json
          weighted_contribution?: number
        }
        Update: {
          active_days?: number
          assignment_id?: string
          burst_ratio?: number
          commit_count?: number
          confidence?: number
          created_at?: string
          draft_feedback?: string | null
          draft_score_completion?: number | null
          draft_score_thinking?: number | null
          draft_score_workflow?: number | null
          evidence_json?: Json
          github_login?: string | null
          grading_model?: string | null
          grading_provenance?: Json | null
          id?: string
          iteration_score?: number
          relative_contribution_share?: number
          run_id?: string
          semantic_breakdown_json?: Json
          session_count?: number
          spread_score?: number
          student_id?: string
          timeline_json?: Json
          weighted_contribution?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignment_repo_review_results_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_repo_review_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assignment_repo_review_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_repo_review_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_repo_review_runs: {
        Row: {
          assignment_id: string
          completed_at: string | null
          created_at: string
          id: string
          metrics_version: string
          model: string | null
          prompt_version: string
          repo_name: string | null
          repo_owner: string | null
          source_ref: string | null
          started_at: string
          status: string
          triggered_by: string
          warnings_json: Json
        }
        Insert: {
          assignment_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          metrics_version?: string
          model?: string | null
          prompt_version?: string
          repo_name?: string | null
          repo_owner?: string | null
          source_ref?: string | null
          started_at?: string
          status?: string
          triggered_by: string
          warnings_json?: Json
        }
        Update: {
          assignment_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          metrics_version?: string
          model?: string | null
          prompt_version?: string
          repo_name?: string | null
          repo_owner?: string | null
          source_ref?: string | null
          started_at?: string
          status?: string
          triggered_by?: string
          warnings_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assignment_repo_review_runs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_repo_review_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_repo_targets: {
        Row: {
          assignment_id: string
          created_at: string
          id: string
          override_github_username: string | null
          repo_name: string | null
          repo_owner: string | null
          selected_repo_url: string | null
          selection_mode: string
          student_id: string
          updated_at: string
          validated_at: string | null
          validation_message: string | null
          validation_status: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          id?: string
          override_github_username?: string | null
          repo_name?: string | null
          repo_owner?: string | null
          selected_repo_url?: string | null
          selection_mode?: string
          student_id: string
          updated_at?: string
          validated_at?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          id?: string
          override_github_username?: string | null
          repo_name?: string | null
          repo_owner?: string | null
          selected_repo_url?: string | null
          selection_mode?: string
          student_id?: string
          updated_at?: string
          validated_at?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_repo_targets_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_repo_targets_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_submission_artifacts: {
        Row: {
          assignment_doc_id: string
          created_at: string
          id: string
          managed_object_id: string | null
          metadata_json: Json
          requirement_id: string
          storage_path: string | null
          student_id: string
          type: string
          updated_at: string
          url: string | null
          validated_at: string | null
          validation_message: string | null
          validation_status: string
        }
        Insert: {
          assignment_doc_id: string
          created_at?: string
          id?: string
          managed_object_id?: string | null
          metadata_json?: Json
          requirement_id: string
          storage_path?: string | null
          student_id: string
          type: string
          updated_at?: string
          url?: string | null
          validated_at?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Update: {
          assignment_doc_id?: string
          created_at?: string
          id?: string
          managed_object_id?: string | null
          metadata_json?: Json
          requirement_id?: string
          storage_path?: string | null
          student_id?: string
          type?: string
          updated_at?: string
          url?: string | null
          validated_at?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submission_artifacts_assignment_doc_id_fkey"
            columns: ["assignment_doc_id"]
            isOneToOne: false
            referencedRelation: "assignment_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submission_artifacts_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submission_artifacts_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "assignment_submission_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submission_artifacts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_submission_requirements: {
        Row: {
          artifact_id: string
          assignment_id: string
          created_at: string
          id: string
          instructions: string
          label: string
          position: number
          required: boolean
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          type: string
          updated_at: string
          validation_policy_json: Json
        }
        Insert: {
          artifact_id?: string
          assignment_id: string
          created_at?: string
          id?: string
          instructions?: string
          label: string
          position?: number
          required?: boolean
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          type: string
          updated_at?: string
          validation_policy_json?: Json
        }
        Update: {
          artifact_id?: string
          assignment_id?: string
          created_at?: string
          id?: string
          instructions?: string
          label?: string
          position?: number
          required?: boolean
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          type?: string
          updated_at?: string
          validation_policy_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submission_requirem_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submission_requirements_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          artifact_id: string
          blueprint_archived_at: string | null
          classroom_id: string
          created_at: string
          created_by: string
          description: string
          due_at: string
          gradebook_category_id: string | null
          gradebook_weight: number
          id: string
          include_in_final: boolean
          instructions_markdown: string | null
          is_draft: boolean
          points_possible: number
          position: number
          released_at: string | null
          rich_instructions: Json | null
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          title: string
          track_authenticity: boolean
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id: string
          created_at?: string
          created_by: string
          description?: string
          due_at: string
          gradebook_category_id?: string | null
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          instructions_markdown?: string | null
          is_draft?: boolean
          points_possible?: number
          position?: number
          released_at?: string | null
          rich_instructions?: Json | null
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          title: string
          track_authenticity?: boolean
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id?: string
          created_at?: string
          created_by?: string
          description?: string
          due_at?: string
          gradebook_category_id?: string | null
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          instructions_markdown?: string | null
          is_draft?: boolean
          points_possible?: number
          position?: number
          released_at?: string | null
          rich_instructions?: Json | null
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          title?: string
          track_authenticity?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_gradebook_category_id_fkey"
            columns: ["gradebook_category_id"]
            isOneToOne: false
            referencedRelation: "gradebook_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_check_in_facts: {
        Row: {
          accepted_at: string
          check_in_ref: string
          check_in_revision: number
          classroom_id: string
          created_at: string
          id: string
          installation_ref: string
          invalidated_at: string | null
          last_event_at: string | null
          last_event_id: string | null
          occurrence_ref: string
          participant_ref: string
          reason_code: string | null
          roster_ref: string
          student_id: string
          updated_at: string
        }
        Insert: {
          accepted_at: string
          check_in_ref: string
          check_in_revision: number
          classroom_id: string
          created_at?: string
          id?: string
          installation_ref: string
          invalidated_at?: string | null
          last_event_at?: string | null
          last_event_id?: string | null
          occurrence_ref: string
          participant_ref: string
          reason_code?: string | null
          roster_ref: string
          student_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string
          check_in_ref?: string
          check_in_revision?: number
          classroom_id?: string
          created_at?: string
          id?: string
          installation_ref?: string
          invalidated_at?: string | null
          last_event_at?: string | null
          last_event_id?: string | null
          occurrence_ref?: string
          participant_ref?: string
          reason_code?: string | null
          roster_ref?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_check_in_facts_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_check_in_facts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_classroom_qr_handles: {
        Row: {
          classroom_id: string
          created_at: string
          generation: number
          handle_id: string
          rotated_at: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          generation?: number
          handle_id?: string
          rotated_at?: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          generation?: number
          handle_id?: string
          rotated_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_classroom_qr_handles_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_decommission_operations: {
        Row: {
          actor_principal_ref: string
          classroom_id: string
          deleted_count: number
          id: string
          installation_ref: string
          phase: number
          remote_deleted_count: number | null
          roster_ref: string
          started_at: string
          state: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          actor_principal_ref: string
          classroom_id: string
          deleted_count?: number
          id: string
          installation_ref: string
          phase?: number
          remote_deleted_count?: number | null
          roster_ref: string
          started_at?: string
          state?: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          actor_principal_ref?: string
          classroom_id?: string
          deleted_count?: number
          id?: string
          installation_ref?: string
          phase?: number
          remote_deleted_count?: number | null
          roster_ref?: string
          started_at?: string
          state?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      attendance_decommission_settings: {
        Row: {
          canary_classroom_id: string | null
          canary_teacher_id: string | null
          installation_ref: string | null
          mode: string
          singleton: boolean
        }
        Insert: {
          canary_classroom_id?: string | null
          canary_teacher_id?: string | null
          installation_ref?: string | null
          mode?: string
          singleton?: boolean
        }
        Update: {
          canary_classroom_id?: string | null
          canary_teacher_id?: string | null
          installation_ref?: string | null
          mode?: string
          singleton?: boolean
        }
        Relationships: []
      }
      attendance_integration_inbox: {
        Row: {
          classroom_id: string
          correlation_ref: string
          event_id: string
          event_type: string
          id: string
          idempotency_key: string
          installation_ref: string
          occurred_at: string
          occurrence_ref: string
          payload: Json
          projection_applied: boolean
          received_at: string
          roster_ref: string
          session_revision: number
          transport_nonce: string
        }
        Insert: {
          classroom_id: string
          correlation_ref: string
          event_id: string
          event_type: string
          id?: string
          idempotency_key: string
          installation_ref: string
          occurred_at: string
          occurrence_ref: string
          payload: Json
          projection_applied?: boolean
          received_at?: string
          roster_ref: string
          session_revision: number
          transport_nonce: string
        }
        Update: {
          classroom_id?: string
          correlation_ref?: string
          event_id?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          installation_ref?: string
          occurred_at?: string
          occurrence_ref?: string
          payload?: Json
          projection_applied?: boolean
          received_at?: string
          roster_ref?: string
          session_revision?: number
          transport_nonce?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_integration_inbox_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_integration_outbox: {
        Row: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          classroom_id: string
          created_at?: string
          delivered_at?: string | null
          entitlement_revision?: number | null
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          message_type: string
          next_attempt_at?: string
          payload: Json
          response_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          classroom_id?: string
          created_at?: string
          delivered_at?: string | null
          entitlement_revision?: number | null
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          message_type?: string
          next_attempt_at?: string
          payload?: Json
          response_payload?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_integration_outbox_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_integration_smoke_nonces: {
        Row: {
          created_at: string
          direction: string
          installation_ref: string
          nonce: string
          request_timestamp: string
        }
        Insert: {
          created_at?: string
          direction: string
          installation_ref: string
          nonce: string
          request_timestamp: string
        }
        Update: {
          created_at?: string
          direction?: string
          installation_ref?: string
          nonce?: string
          request_timestamp?: string
        }
        Relationships: []
      }
      attendance_integration_smoke_runs: {
        Row: {
          bara_to_pika: boolean | null
          callback_consumed_at: string | null
          challenge_hash: string
          classroom_id: string
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          installation_ref: string
          pika_to_bara: boolean | null
          request_id: string
          status: string
          teacher_id: string
        }
        Insert: {
          bara_to_pika?: boolean | null
          callback_consumed_at?: string | null
          challenge_hash: string
          classroom_id: string
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          installation_ref: string
          pika_to_bara?: boolean | null
          request_id: string
          status: string
          teacher_id: string
        }
        Update: {
          bara_to_pika?: boolean | null
          callback_consumed_at?: string | null
          challenge_hash?: string
          classroom_id?: string
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          installation_ref?: string
          pika_to_bara?: boolean | null
          request_id?: string
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_integration_smoke_runs_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_integration_smoke_runs_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_occurrence_mappings: {
        Row: {
          absent_at: string | null
          class_date: string
          classroom_id: string
          closes_at: string | null
          created_at: string
          desired_state: string
          last_reconciled_at: string | null
          occurrence_ref: string
          opens_at: string | null
          policy_frozen_at: string | null
          policy_revision: number | null
          present_through_at: string | null
          session_ends_at: string | null
          session_starts_at: string | null
          source_revision: number
          synced_revision: number | null
          updated_at: string
        }
        Insert: {
          absent_at?: string | null
          class_date: string
          classroom_id: string
          closes_at?: string | null
          created_at?: string
          desired_state?: string
          last_reconciled_at?: string | null
          occurrence_ref?: string
          opens_at?: string | null
          policy_frozen_at?: string | null
          policy_revision?: number | null
          present_through_at?: string | null
          session_ends_at?: string | null
          session_starts_at?: string | null
          source_revision?: number
          synced_revision?: number | null
          updated_at?: string
        }
        Update: {
          absent_at?: string | null
          class_date?: string
          classroom_id?: string
          closes_at?: string | null
          created_at?: string
          desired_state?: string
          last_reconciled_at?: string | null
          occurrence_ref?: string
          opens_at?: string | null
          policy_frozen_at?: string | null
          policy_revision?: number | null
          present_through_at?: string | null
          session_ends_at?: string | null
          session_starts_at?: string | null
          source_revision?: number
          synced_revision?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_occurrence_mappings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_outbox_epoch_recovery_audit: {
        Row: {
          actor_ref: string
          created_at: string
          id: string
          new_entitlement_revision: number
          operation_id: string
          outbox_ids: string[]
          previous_entitlement_revision: number
          reason_code: string
          request_fingerprint: string
          superseded_count: number
          teacher_id: string
        }
        Insert: {
          actor_ref: string
          created_at?: string
          id?: string
          new_entitlement_revision: number
          operation_id: string
          outbox_ids: string[]
          previous_entitlement_revision: number
          reason_code: string
          request_fingerprint: string
          superseded_count: number
          teacher_id: string
        }
        Update: {
          actor_ref?: string
          created_at?: string
          id?: string
          new_entitlement_revision?: number
          operation_id?: string
          outbox_ids?: string[]
          previous_entitlement_revision?: number
          reason_code?: string
          request_fingerprint?: string
          superseded_count?: number
          teacher_id?: string
        }
        Relationships: []
      }
      attendance_override_requests: {
        Row: {
          classroom_id: string
          created_at: string
          request_fingerprint: string
          request_id: string
          result: Json
        }
        Insert: {
          classroom_id: string
          created_at?: string
          request_fingerprint: string
          request_id: string
          result: Json
        }
        Update: {
          classroom_id?: string
          created_at?: string
          request_fingerprint?: string
          request_id?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "attendance_override_requests_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_participant_mappings: {
        Row: {
          active: boolean
          classroom_id: string
          created_at: string
          participant_ref: string
          student_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          classroom_id: string
          created_at?: string
          participant_ref?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          classroom_id?: string
          created_at?: string
          participant_ref?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_participant_mappings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_participant_mappings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_principal_mappings: {
        Row: {
          created_at: string
          principal_ref: string
          user_id: string
        }
        Insert: {
          created_at?: string
          principal_ref?: string
          user_id: string
        }
        Update: {
          created_at?: string
          principal_ref?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_principal_mappings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_record_projection: {
        Row: {
          actor_type: string
          classroom_id: string
          id: string
          installation_ref: string
          last_event_at: string
          last_event_id: string
          occurrence_ref: string
          participant_ref: string
          reason_code: string | null
          record_revision: number
          roster_ref: string
          source: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          actor_type: string
          classroom_id: string
          id?: string
          installation_ref: string
          last_event_at: string
          last_event_id: string
          occurrence_ref: string
          participant_ref: string
          reason_code?: string | null
          record_revision: number
          roster_ref: string
          source: string
          status: string
          student_id: string
          updated_at?: string
        }
        Update: {
          actor_type?: string
          classroom_id?: string
          id?: string
          installation_ref?: string
          last_event_at?: string
          last_event_id?: string
          occurrence_ref?: string
          participant_ref?: string
          reason_code?: string | null
          record_revision?: number
          roster_ref?: string
          source?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_record_projection_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_projection_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_roster_mappings: {
        Row: {
          classroom_id: string
          created_at: string
          deactivation_requested_at: string | null
          deactivation_target_end: string | null
          deactivation_window_end: string | null
          deactivation_window_start: string | null
          inactive_at: string | null
          integration_state: string
          remote_schedule_window_end: string | null
          roster_ref: string
          schedule_source_revision: number
          schedule_source_token: string | null
          schedule_staged_revision: number | null
          schedule_synced_revision: number | null
          source_revision: number
          source_token: string | null
          staged_revision: number | null
          synced_revision: number | null
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          deactivation_requested_at?: string | null
          deactivation_target_end?: string | null
          deactivation_window_end?: string | null
          deactivation_window_start?: string | null
          inactive_at?: string | null
          integration_state?: string
          remote_schedule_window_end?: string | null
          roster_ref?: string
          schedule_source_revision?: number
          schedule_source_token?: string | null
          schedule_staged_revision?: number | null
          schedule_synced_revision?: number | null
          source_revision?: number
          source_token?: string | null
          staged_revision?: number | null
          synced_revision?: number | null
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          deactivation_requested_at?: string | null
          deactivation_target_end?: string | null
          deactivation_window_end?: string | null
          deactivation_window_start?: string | null
          inactive_at?: string | null
          integration_state?: string
          remote_schedule_window_end?: string | null
          roster_ref?: string
          schedule_source_revision?: number
          schedule_source_token?: string | null
          schedule_staged_revision?: number | null
          schedule_synced_revision?: number | null
          source_revision?: number
          source_token?: string | null
          staged_revision?: number | null
          synced_revision?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_roster_mappings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_session_projection: {
        Row: {
          classroom_id: string
          closes_at: string | null
          id: string
          installation_ref: string
          last_event_at: string
          last_event_id: string
          occurrence_ref: string
          opens_at: string | null
          roster_ref: string
          session_revision: number
          status: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          closes_at?: string | null
          id?: string
          installation_ref: string
          last_event_at: string
          last_event_id: string
          occurrence_ref: string
          opens_at?: string | null
          roster_ref: string
          session_revision: number
          status: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          closes_at?: string | null
          id?: string
          installation_ref?: string
          last_event_at?: string
          last_event_id?: string
          occurrence_ref?: string
          opens_at?: string | null
          roster_ref?: string
          session_revision?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_session_projection_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_status_override_events: {
        Row: {
          action: string
          actor_user_id: string
          classroom_id: string
          created_at: string
          id: string
          occurrence_ref: string
          override_id: string
          reason_code: string | null
          request_id: string
          revision: number
          status: string | null
          student_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          classroom_id: string
          created_at?: string
          id?: string
          occurrence_ref: string
          override_id: string
          reason_code?: string | null
          request_id: string
          revision: number
          status?: string | null
          student_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          classroom_id?: string
          created_at?: string
          id?: string
          occurrence_ref?: string
          override_id?: string
          reason_code?: string | null
          request_id?: string
          revision?: number
          status?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_status_override_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_status_override_events_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_status_override_events_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "attendance_status_overrides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_status_override_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_status_overrides: {
        Row: {
          active: boolean
          classroom_id: string
          created_at: string
          id: string
          occurrence_ref: string
          reason_code: string | null
          revision: number
          status: string | null
          student_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          active: boolean
          classroom_id: string
          created_at?: string
          id?: string
          occurrence_ref: string
          reason_code?: string | null
          revision?: number
          status?: string | null
          student_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          active?: boolean
          classroom_id?: string
          created_at?: string
          id?: string
          occurrence_ref?: string
          reason_code?: string | null
          revision?: number
          status?: string | null
          student_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_status_overrides_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_status_overrides_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_status_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_teacher_entitlement_audit: {
        Row: {
          actor_ref: string
          created_at: string
          entitlement_revision: number
          id: string
          new_status: string
          operation_id: string
          previous_status: string | null
          reason_code: string
          request_fingerprint: string
          source: string
          teacher_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          actor_ref: string
          created_at?: string
          entitlement_revision: number
          id?: string
          new_status: string
          operation_id: string
          previous_status?: string | null
          reason_code: string
          request_fingerprint: string
          source: string
          teacher_id: string
          valid_from: string
          valid_until?: string | null
        }
        Update: {
          actor_ref?: string
          created_at?: string
          entitlement_revision?: number
          id?: string
          new_status?: string
          operation_id?: string
          previous_status?: string | null
          reason_code?: string
          request_fingerprint?: string
          source?: string
          teacher_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      attendance_teacher_entitlements: {
        Row: {
          created_at: string
          revision: number
          source: string
          status: string
          teacher_id: string
          updated_at: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          revision: number
          source: string
          status: string
          teacher_id: string
          updated_at?: string
          valid_from: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          revision?: number
          source?: string
          status?: string
          teacher_id?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_teacher_entitlements_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_window_policies: {
        Row: {
          absent_minutes_before_end: number
          classroom_id: string
          close_day_offset: number
          closes_local: string
          created_at: string
          enabled: boolean
          entry_closes_minutes_before_end: number
          entry_opens_minutes_before: number
          opens_local: string
          policy_revision: number
          present_grace_minutes: number
          timezone: string
          updated_at: string
        }
        Insert: {
          absent_minutes_before_end?: number
          classroom_id: string
          close_day_offset?: number
          closes_local: string
          created_at?: string
          enabled?: boolean
          entry_closes_minutes_before_end?: number
          entry_opens_minutes_before?: number
          opens_local: string
          policy_revision?: number
          present_grace_minutes?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          absent_minutes_before_end?: number
          classroom_id?: string
          close_day_offset?: number
          closes_local?: string
          created_at?: string
          enabled?: boolean
          entry_closes_minutes_before_end?: number
          entry_opens_minutes_before?: number
          opens_local?: string
          policy_revision?: number
          present_grace_minutes?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_window_policies_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_global_rate_limits: {
        Row: {
          attempt_count: number
          key_hash: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          attempt_count?: number
          key_hash: string
          updated_at?: string
          window_started_at: string
        }
        Update: {
          attempt_count?: number
          key_hash?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      auth_rate_limits: {
        Row: {
          attempt_timestamps: string[]
          key_hash: string
          scope: string
          updated_at: string
        }
        Insert: {
          attempt_timestamps?: string[]
          key_hash: string
          scope: string
          updated_at?: string
        }
        Update: {
          attempt_timestamps?: string[]
          key_hash?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      auth_sessions: {
        Row: {
          auth_source: string
          created_at: string
          credential_version: number
          expires_at: string
          id: string
          token_hash: string
          user_id: string
          workos_user_id: string | null
        }
        Insert: {
          auth_source: string
          created_at?: string
          credential_version: number
          expires_at: string
          id?: string
          token_hash: string
          user_id: string
          workos_user_id?: string | null
        }
        Update: {
          auth_source?: string
          created_at?: string
          credential_version?: number
          expires_at?: string
          id?: string
          token_hash?: string
          user_id?: string
          workos_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      class_days: {
        Row: {
          classroom_id: string
          date: string
          id: string
          is_class_day: boolean
          prompt_text: string | null
        }
        Insert: {
          classroom_id: string
          date: string
          id?: string
          is_class_day?: boolean
          prompt_text?: string | null
        }
        Update: {
          classroom_id?: string
          date?: string
          id?: string
          is_class_day?: boolean
          prompt_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_days_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archive_object_upload_cleanup: {
        Row: {
          attempt_count: number
          created_at: string
          deleted_at: string | null
          expected_byte_size: number
          expected_sha256: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          deleted_at?: string | null
          expected_byte_size: number
          expected_sha256: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          operation_id: string
          status?: string
          storage_bucket: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          deleted_at?: string | null
          expected_byte_size?: number
          expected_sha256?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          operation_id?: string
          status?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_object_upload_cleanup_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archive_object_upload_cleanup_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archive_operations: {
        Row: {
          adapter_chain: Json | null
          archive_format_version: number
          archive_id: string | null
          artifact_sha256: string | null
          attempt_count: number
          classroom_id: string
          completed_at: string | null
          compressed_byte_size: number | null
          content_sha256: string | null
          error_code: string | null
          id: string
          managed_object_id: string | null
          operation_type: string
          request_sha256: string
          resource_counts: Json
          restore_contract_version: number
          retention: Json
          retryable: boolean | null
          snapshot_created_at: string
          snapshot_expires_at: string
          source_app_commit: string
          source_contract_version: number
          source_object_cleanup_staged_at: string | null
          source_resource_counts: Json
          source_revision: number
          source_schema_migration: string
          status: string
          storage_bucket: string | null
          storage_object_counts: Json
          storage_path: string | null
          target_schema_migration: string | null
          teacher_id: string
          uncompressed_byte_size: number | null
          updated_at: string
          verification: Json | null
        }
        Insert: {
          adapter_chain?: Json | null
          archive_format_version?: number
          archive_id?: string | null
          artifact_sha256?: string | null
          attempt_count?: number
          classroom_id: string
          completed_at?: string | null
          compressed_byte_size?: number | null
          content_sha256?: string | null
          error_code?: string | null
          id: string
          managed_object_id?: string | null
          operation_type?: string
          request_sha256: string
          resource_counts?: Json
          restore_contract_version?: number
          retention: Json
          retryable?: boolean | null
          snapshot_created_at: string
          snapshot_expires_at: string
          source_app_commit: string
          source_contract_version?: number
          source_object_cleanup_staged_at?: string | null
          source_resource_counts?: Json
          source_revision: number
          source_schema_migration: string
          status: string
          storage_bucket?: string | null
          storage_object_counts?: Json
          storage_path?: string | null
          target_schema_migration?: string | null
          teacher_id: string
          uncompressed_byte_size?: number | null
          updated_at?: string
          verification?: Json | null
        }
        Update: {
          adapter_chain?: Json | null
          archive_format_version?: number
          archive_id?: string | null
          artifact_sha256?: string | null
          attempt_count?: number
          classroom_id?: string
          completed_at?: string | null
          compressed_byte_size?: number | null
          content_sha256?: string | null
          error_code?: string | null
          id?: string
          managed_object_id?: string | null
          operation_type?: string
          request_sha256?: string
          resource_counts?: Json
          restore_contract_version?: number
          retention?: Json
          retryable?: boolean | null
          snapshot_created_at?: string
          snapshot_expires_at?: string
          source_app_commit?: string
          source_contract_version?: number
          source_object_cleanup_staged_at?: string | null
          source_resource_counts?: Json
          source_revision?: number
          source_schema_migration?: string
          status?: string
          storage_bucket?: string | null
          storage_object_counts?: Json
          storage_path?: string | null
          target_schema_migration?: string | null
          teacher_id?: string
          uncompressed_byte_size?: number | null
          updated_at?: string
          verification?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_operations_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archive_resource_contract: {
        Row: {
          actor_columns: string[]
          export_position: number
          parent_column: string | null
          parent_table: string | null
          primary_key_columns: string[]
          restore_after: string[]
          table_name: string
        }
        Insert: {
          actor_columns?: string[]
          export_position: number
          parent_column?: string | null
          parent_table?: string | null
          primary_key_columns: string[]
          restore_after: string[]
          table_name: string
        }
        Update: {
          actor_columns?: string[]
          export_position?: number
          parent_column?: string | null
          parent_table?: string | null
          primary_key_columns?: string[]
          restore_after?: string[]
          table_name?: string
        }
        Relationships: []
      }
      classroom_archive_resource_contract_versions: {
        Row: {
          actor_columns: string[]
          export_position: number
          format_version: number
          parent_column: string | null
          parent_table: string | null
          primary_key_columns: string[]
          restore_after: string[]
          table_name: string
        }
        Insert: {
          actor_columns?: string[]
          export_position: number
          format_version: number
          parent_column?: string | null
          parent_table?: string | null
          primary_key_columns: string[]
          restore_after: string[]
          table_name: string
        }
        Update: {
          actor_columns?: string[]
          export_position?: number
          format_version?: number
          parent_column?: string | null
          parent_table?: string | null
          primary_key_columns?: string[]
          restore_after?: string[]
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_resource_versions_parent_fkey"
            columns: ["format_version", "parent_table"]
            isOneToOne: false
            referencedRelation: "classroom_archive_resource_contract_versions"
            referencedColumns: ["format_version", "table_name"]
          },
        ]
      }
      classroom_archive_restore_expected_objects: {
        Row: {
          expected_byte_size: number
          expected_sha256: string
          managed_object_id: string | null
          operation_id: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          expected_byte_size: number
          expected_sha256: string
          managed_object_id?: string | null
          operation_id: string
          storage_bucket: string
          storage_path: string
        }
        Update: {
          expected_byte_size?: number
          expected_sha256?: string
          managed_object_id?: string | null
          operation_id?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_restore_expected_objec_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archive_restore_expected_objects_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archive_restore_staging: {
        Row: {
          operation_id: string
          restore_contract_version: number
          row_data: Json
          row_id: string
          staged_at: string
          table_name: string
        }
        Insert: {
          operation_id: string
          restore_contract_version?: number
          row_data: Json
          row_id: string
          staged_at?: string
          table_name: string
        }
        Update: {
          operation_id?: string
          restore_contract_version?: number
          row_data?: Json
          row_id?: string
          staged_at?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_restore_staging_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archive_restore_staging_versioned_resource_fkey"
            columns: ["restore_contract_version", "table_name"]
            isOneToOne: false
            referencedRelation: "classroom_archive_resource_contract_versions"
            referencedColumns: ["format_version", "table_name"]
          },
        ]
      }
      classroom_archive_revisions: {
        Row: {
          classroom_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          classroom_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      classroom_archive_snapshot_actors: {
        Row: {
          actor_id: string
          operation_id: string
          snapshot: Json
        }
        Insert: {
          actor_id: string
          operation_id: string
          snapshot: Json
        }
        Update: {
          actor_id?: string
          operation_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_snapshot_actors_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archive_snapshot_resources: {
        Row: {
          operation_id: string
          row_id: string
          source_contract_version: number
          table_name: string
        }
        Insert: {
          operation_id: string
          row_id: string
          source_contract_version?: number
          table_name: string
        }
        Update: {
          operation_id?: string
          row_id?: string
          source_contract_version?: number
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_snapshot_resources_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archive_snapshot_resources_versioned_resource_fkey"
            columns: ["source_contract_version", "table_name"]
            isOneToOne: false
            referencedRelation: "classroom_archive_resource_contract_versions"
            referencedColumns: ["format_version", "table_name"]
          },
        ]
      }
      classroom_archive_source_object_cleanup: {
        Row: {
          archive_id: string
          attempt_count: number
          classroom_id: string
          created_at: string
          deleted_at: string | null
          expected_byte_size: number
          expected_sha256: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          operation_id: string
          ownership_verified: boolean
          ownership_verified_at: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          archive_id: string
          attempt_count?: number
          classroom_id: string
          created_at?: string
          deleted_at?: string | null
          expected_byte_size: number
          expected_sha256: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          operation_id: string
          ownership_verified?: boolean
          ownership_verified_at?: string | null
          status?: string
          storage_bucket: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          archive_id?: string
          attempt_count?: number
          classroom_id?: string
          created_at?: string
          deleted_at?: string | null
          expected_byte_size?: number
          expected_sha256?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          operation_id?: string
          ownership_verified?: boolean
          ownership_verified_at?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_source_object_cleanup_archive_id_fkey"
            columns: ["archive_id"]
            isOneToOne: false
            referencedRelation: "classroom_archives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archive_source_object_cleanup_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archive_source_object_cleanup_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archive_source_object_reservations: {
        Row: {
          operation_id: string | null
          reserved_at: string
          storage_bucket: string
          storage_path_sha256: string
        }
        Insert: {
          operation_id?: string | null
          reserved_at?: string
          storage_bucket: string
          storage_path_sha256: string
        }
        Update: {
          operation_id?: string | null
          reserved_at?: string
          storage_bucket?: string
          storage_path_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archive_source_object_reservations_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_archives: {
        Row: {
          artifact_sha256: string
          classroom_id: string
          compressed_byte_size: number
          content_sha256: string
          created_at: string
          format: string
          format_version: number
          id: string
          managed_object_id: string | null
          operation_id: string
          resource_counts: Json
          retention: Json
          source_app_commit: string
          source_revision: number
          source_schema_migration: string
          storage_bucket: string
          storage_object_counts: Json
          storage_path: string
          teacher_id: string
          uncompressed_byte_size: number
          verification: Json
          verified_at: string
        }
        Insert: {
          artifact_sha256: string
          classroom_id: string
          compressed_byte_size: number
          content_sha256: string
          created_at: string
          format: string
          format_version: number
          id: string
          managed_object_id?: string | null
          operation_id: string
          resource_counts: Json
          retention: Json
          source_app_commit: string
          source_revision: number
          source_schema_migration: string
          storage_bucket: string
          storage_object_counts: Json
          storage_path: string
          teacher_id: string
          uncompressed_byte_size: number
          verification: Json
          verified_at: string
        }
        Update: {
          artifact_sha256?: string
          classroom_id?: string
          compressed_byte_size?: number
          content_sha256?: string
          created_at?: string
          format?: string
          format_version?: number
          id?: string
          managed_object_id?: string | null
          operation_id?: string
          resource_counts?: Json
          retention?: Json
          source_app_commit?: string
          source_revision?: number
          source_schema_migration?: string
          storage_bucket?: string
          storage_object_counts?: Json
          storage_path?: string
          teacher_id?: string
          uncompressed_byte_size?: number
          verification?: Json
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_archives_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_archives_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_cold_archive_actors: {
        Row: {
          actor_id: string
          actor_role: string
          classroom_id: string
        }
        Insert: {
          actor_id: string
          actor_role: string
          classroom_id: string
        }
        Update: {
          actor_id?: string
          actor_role?: string
          classroom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_cold_archive_actors_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_cold_archive_actors_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classroom_cold_tombstones"
            referencedColumns: ["classroom_id"]
          },
        ]
      }
      classroom_cold_tombstones: {
        Row: {
          archive_id: string
          archived_at: string
          classroom_id: string
          compacted_at: string
          created_at: string
          source_revision: number
          teacher_id: string
          title: string
        }
        Insert: {
          archive_id: string
          archived_at: string
          classroom_id: string
          compacted_at?: string
          created_at?: string
          source_revision: number
          teacher_id: string
          title: string
        }
        Update: {
          archive_id?: string
          archived_at?: string
          classroom_id?: string
          compacted_at?: string
          created_at?: string
          source_revision?: number
          teacher_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_cold_tombstones_archive_id_fkey"
            columns: ["archive_id"]
            isOneToOne: true
            referencedRelation: "classroom_archives"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_enrollments: {
        Row: {
          classroom_id: string
          created_at: string
          id: string
          manual_attendance_marks: Json
          student_id: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          id?: string
          manual_attendance_marks?: Json
          student_id: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          id?: string
          manual_attendance_marks?: Json
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_enrollments_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_gradex_extract_cleanup: {
        Row: {
          attempt_count: number
          delete_after: string
          deleted_at: string | null
          extract_id: string | null
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string
          superseded_by_extract_id: string | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          delete_after: string
          deleted_at?: string | null
          extract_id?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at: string
          operation_id: string
          status?: string
          storage_bucket: string
          storage_path: string
          superseded_by_extract_id?: string | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          delete_after?: string
          deleted_at?: string | null
          extract_id?: string | null
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          operation_id?: string
          status?: string
          storage_bucket?: string
          storage_path?: string
          superseded_by_extract_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_gradex_extract_cleanup_extract_id_fkey"
            columns: ["extract_id"]
            isOneToOne: true
            referencedRelation: "classroom_gradex_extracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_gradex_extract_cleanup_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_gradex_extract_cleanup_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_gradex_extract_cleanup_superseded_by_extract_id_fkey"
            columns: ["superseded_by_extract_id"]
            isOneToOne: false
            referencedRelation: "classroom_gradex_extracts"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_gradex_extracts: {
        Row: {
          artifact_sha256: string
          classroom_id: string
          compressed_byte_size: number
          content_sha256: string
          delete_after: string
          format: string
          format_version: number
          generated_at: string
          id: string
          managed_object_id: string | null
          operation_id: string
          resource_counts: Json
          source_archive_id: string
          source_archive_sha256: string
          storage_bucket: string
          storage_path: string
          teacher_id: string
          uncompressed_byte_size: number
          verification: Json
          verified_at: string
        }
        Insert: {
          artifact_sha256: string
          classroom_id: string
          compressed_byte_size: number
          content_sha256: string
          delete_after: string
          format: string
          format_version: number
          generated_at: string
          id: string
          managed_object_id?: string | null
          operation_id: string
          resource_counts: Json
          source_archive_id: string
          source_archive_sha256: string
          storage_bucket: string
          storage_path: string
          teacher_id: string
          uncompressed_byte_size: number
          verification: Json
          verified_at: string
        }
        Update: {
          artifact_sha256?: string
          classroom_id?: string
          compressed_byte_size?: number
          content_sha256?: string
          delete_after?: string
          format?: string
          format_version?: number
          generated_at?: string
          id?: string
          managed_object_id?: string | null
          operation_id?: string
          resource_counts?: Json
          source_archive_id?: string
          source_archive_sha256?: string
          storage_bucket?: string
          storage_path?: string
          teacher_id?: string
          uncompressed_byte_size?: number
          verification?: Json
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_gradex_extracts_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_gradex_extracts_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "classroom_archive_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_gradex_extracts_source_archive_id_fkey"
            columns: ["source_archive_id"]
            isOneToOne: false
            referencedRelation: "classroom_archives"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_gradex_resource_contract: {
        Row: {
          table_name: string
        }
        Insert: {
          table_name: string
        }
        Update: {
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_gradex_resource_contract_table_name_fkey"
            columns: ["table_name"]
            isOneToOne: true
            referencedRelation: "classroom_archive_resource_contract"
            referencedColumns: ["table_name"]
          },
        ]
      }
      classroom_purge_fences: {
        Row: {
          classroom_id: string
          created_at: string
          operation_id: string
          teacher_id: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          operation_id: string
          teacher_id: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          operation_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_purge_fences_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_purge_fences_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "classroom_purge_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_purge_fences_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_purge_objects: {
        Row: {
          attempt_count: number
          created_at: string
          delete_priority: number
          deleted_at: string | null
          disposition: string
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delete_priority?: number
          deleted_at?: string | null
          disposition: string
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_storage_object_id?: string | null
          next_attempt_at?: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path?: string | null
          storage_path_sha256: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delete_priority?: number
          deleted_at?: string | null
          disposition?: string
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_storage_object_id?: string | null
          next_attempt_at?: string
          operation_id?: string
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          storage_path_sha256?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_purge_objects_managed_storage_object_id_fkey"
            columns: ["managed_storage_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_purge_objects_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_purge_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_purge_operations: {
        Row: {
          attempt_count: number
          classroom_id: string
          classroom_title: string | null
          cold_archive_id: string | null
          completed_at: string | null
          error_code: string | null
          id: string
          impact_summary: Json
          inventory_completed_at: string | null
          purge_scope: string
          request_sha256: string
          resource_counts: Json
          retryable: boolean | null
          source_revision: number
          started_at: string
          status: string
          storage_object_counts: Json
          teacher_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          classroom_id: string
          classroom_title?: string | null
          cold_archive_id?: string | null
          completed_at?: string | null
          error_code?: string | null
          id: string
          impact_summary: Json
          inventory_completed_at?: string | null
          purge_scope?: string
          request_sha256: string
          resource_counts?: Json
          retryable?: boolean | null
          source_revision: number
          started_at?: string
          status?: string
          storage_object_counts?: Json
          teacher_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          classroom_id?: string
          classroom_title?: string | null
          cold_archive_id?: string | null
          completed_at?: string | null
          error_code?: string | null
          id?: string
          impact_summary?: Json
          inventory_completed_at?: string | null
          purge_scope?: string
          request_sha256?: string
          resource_counts?: Json
          retryable?: boolean | null
          source_revision?: number
          started_at?: string
          status?: string
          storage_object_counts?: Json
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_purge_operations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_purge_resources: {
        Row: {
          operation_id: string
          row_id: string
          table_name: string
        }
        Insert: {
          operation_id: string
          row_id: string
          table_name: string
        }
        Update: {
          operation_id?: string
          row_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_purge_resources_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_purge_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_purge_resources_table_name_fkey"
            columns: ["table_name"]
            isOneToOne: false
            referencedRelation: "classroom_archive_resource_contract"
            referencedColumns: ["table_name"]
          },
        ]
      }
      classroom_purge_settings: {
        Row: {
          canary_classroom_id: string | null
          canary_teacher_id: string | null
          rollout_mode: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          canary_classroom_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          canary_classroom_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_purge_settings_canary_teacher_id_fkey"
            columns: ["canary_teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_resources: {
        Row: {
          classroom_id: string
          content: Json
          id: string
          save_revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          classroom_id: string
          content?: Json
          id?: string
          save_revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          classroom_id?: string
          content?: Json
          id?: string
          save_revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classroom_materials_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_materials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_retired_assessment_record_actors: {
        Row: {
          actor_id: string
          id: string
          record_id: string
          source_column: string
        }
        Insert: {
          actor_id: string
          id: string
          record_id: string
          source_column: string
        }
        Update: {
          actor_id?: string
          id?: string
          record_id?: string
          source_column?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_retired_assessment_record_actors_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_retired_assessment_record_actors_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "classroom_retired_assessment_records"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_retired_assessment_records: {
        Row: {
          checksum_algorithm: string
          classroom_id: string
          id: string
          parent_source_resource: string | null
          parent_source_row_id: string | null
          payload: Json
          payload_sha256: string
          source_contract: string
          source_contract_version: number
          source_created_at: string | null
          source_resource: string
          source_row_id: string
          source_updated_at: string | null
        }
        Insert: {
          checksum_algorithm: string
          classroom_id: string
          id: string
          parent_source_resource?: string | null
          parent_source_row_id?: string | null
          payload: Json
          payload_sha256: string
          source_contract: string
          source_contract_version: number
          source_created_at?: string | null
          source_resource: string
          source_row_id: string
          source_updated_at?: string | null
        }
        Update: {
          checksum_algorithm?: string
          classroom_id?: string
          id?: string
          parent_source_resource?: string | null
          parent_source_row_id?: string | null
          payload?: Json
          payload_sha256?: string
          source_contract?: string
          source_contract_version?: number
          source_created_at?: string | null
          source_resource?: string
          source_row_id?: string
          source_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classroom_retired_assessment__classroom_id_source_contract_fkey"
            columns: [
              "classroom_id",
              "source_contract",
              "source_contract_version",
              "parent_source_resource",
              "parent_source_row_id",
            ]
            isOneToOne: false
            referencedRelation: "classroom_retired_assessment_records"
            referencedColumns: [
              "classroom_id",
              "source_contract",
              "source_contract_version",
              "source_resource",
              "source_row_id",
            ]
          },
          {
            foreignKeyName: "classroom_retired_assessment_records_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_roster: {
        Row: {
          classroom_id: string
          counselor_email: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          join_source: string
          last_name: string | null
          student_number: string | null
          updated_at: string
        }
        Insert: {
          classroom_id: string
          counselor_email?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          join_source?: string
          last_name?: string | null
          student_number?: string | null
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          counselor_email?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          join_source?: string
          last_name?: string | null
          student_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_roster_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_roster_student_bindings: {
        Row: {
          classroom_id: string
          created_at: string
          roster_id: string
          student_id: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          roster_id: string
          student_id: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          roster_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classroom_roster_student_bindings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_roster_student_bindings_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: true
            referencedRelation: "classroom_roster"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_roster_student_bindings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classrooms: {
        Row: {
          actual_site_config: Json
          actual_site_published: boolean
          actual_site_slug: string | null
          allow_enrollment: boolean
          archived_at: string | null
          blueprint_source_revision: number
          class_code: string
          course_outline_markdown: string
          course_overview_markdown: string
          created_at: string
          end_date: string | null
          feature_visibility: Json
          id: string
          join_policy: string
          lesson_plan_visibility: string
          manual_attendance_revision: number
          manual_attendance_session_ends_local: string | null
          manual_attendance_session_starts_local: string | null
          manual_attendance_source_mode: string
          position: number
          source_blueprint_id: string | null
          source_blueprint_origin: Json | null
          source_blueprint_version_id: string | null
          start_date: string | null
          teacher_id: string
          term_label: string | null
          theme_color: string
          title: string
          updated_at: string
        }
        Insert: {
          actual_site_config?: Json
          actual_site_published?: boolean
          actual_site_slug?: string | null
          allow_enrollment?: boolean
          archived_at?: string | null
          blueprint_source_revision?: number
          class_code: string
          course_outline_markdown?: string
          course_overview_markdown?: string
          created_at?: string
          end_date?: string | null
          feature_visibility?: Json
          id?: string
          join_policy?: string
          lesson_plan_visibility?: string
          manual_attendance_revision?: number
          manual_attendance_session_ends_local?: string | null
          manual_attendance_session_starts_local?: string | null
          manual_attendance_source_mode?: string
          position?: number
          source_blueprint_id?: string | null
          source_blueprint_origin?: Json | null
          source_blueprint_version_id?: string | null
          start_date?: string | null
          teacher_id: string
          term_label?: string | null
          theme_color?: string
          title: string
          updated_at?: string
        }
        Update: {
          actual_site_config?: Json
          actual_site_published?: boolean
          actual_site_slug?: string | null
          allow_enrollment?: boolean
          archived_at?: string | null
          blueprint_source_revision?: number
          class_code?: string
          course_outline_markdown?: string
          course_overview_markdown?: string
          created_at?: string
          end_date?: string | null
          feature_visibility?: Json
          id?: string
          join_policy?: string
          lesson_plan_visibility?: string
          manual_attendance_revision?: number
          manual_attendance_session_ends_local?: string | null
          manual_attendance_session_starts_local?: string | null
          manual_attendance_source_mode?: string
          position?: number
          source_blueprint_id?: string | null
          source_blueprint_origin?: Json | null
          source_blueprint_version_id?: string | null
          start_date?: string | null
          teacher_id?: string
          term_label?: string | null
          theme_color?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classrooms_source_blueprint_id_fkey"
            columns: ["source_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classrooms_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classrooms_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      classwork_materials: {
        Row: {
          artifact_id: string
          blueprint_archived_at: string | null
          classroom_id: string
          content: Json
          created_at: string
          created_by: string
          id: string
          is_draft: boolean
          position: number
          released_at: string | null
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id: string
          content?: Json
          created_at?: string
          created_by: string
          id?: string
          is_draft?: boolean
          position: number
          released_at?: string | null
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id?: string
          content?: Json
          created_at?: string
          created_by?: string
          id?: string
          is_draft?: boolean
          position?: number
          released_at?: string | null
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classwork_materials_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classwork_materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classwork_materials_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      cleanup_history_cron_runs: {
        Row: {
          completed_at: string | null
          deployment_id: string | null
          error_code: string | null
          http_status: number | null
          id: string
          invocation_source: string
          job_name: string
          metrics: Json
          schedule: string | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          deployment_id?: string | null
          error_code?: string | null
          http_status?: number | null
          id?: string
          invocation_source: string
          job_name?: string
          metrics?: Json
          schedule?: string | null
          started_at?: string
          status: string
        }
        Update: {
          completed_at?: string | null
          deployment_id?: string | null
          error_code?: string | null
          http_status?: number | null
          id?: string
          invocation_source?: string
          job_name?: string
          metrics?: Json
          schedule?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      cold_classroom_purge_fences: {
        Row: {
          archive_id: string
          classroom_id: string
          created_at: string
          operation_id: string
          teacher_id: string
        }
        Insert: {
          archive_id: string
          classroom_id: string
          created_at?: string
          operation_id: string
          teacher_id: string
        }
        Update: {
          archive_id?: string
          classroom_id?: string
          created_at?: string
          operation_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cold_classroom_purge_fences_archive_id_fkey"
            columns: ["archive_id"]
            isOneToOne: false
            referencedRelation: "classroom_archives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cold_classroom_purge_fences_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classroom_cold_tombstones"
            referencedColumns: ["classroom_id"]
          },
          {
            foreignKeyName: "cold_classroom_purge_fences_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "classroom_purge_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cold_classroom_purge_fences_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cold_classroom_purge_resources: {
        Row: {
          identity_sha256: string
          operation_id: string
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          identity_sha256: string
          operation_id: string
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          identity_sha256?: string
          operation_id?: string
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cold_classroom_purge_resources_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "classroom_purge_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      cold_classroom_purge_settings: {
        Row: {
          canary_classroom_id: string | null
          canary_teacher_id: string | null
          rollout_mode: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          canary_classroom_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          canary_classroom_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cold_classroom_purge_settings_canary_teacher_id_fkey"
            columns: ["canary_teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_assessments: {
        Row: {
          artifact_id: string
          assessment_type: string
          content: Json
          course_blueprint_id: string
          created_at: string
          documents: Json
          gradebook_weight: number
          id: string
          include_in_final: boolean
          points_possible: number | null
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          assessment_type: string
          content?: Json
          course_blueprint_id: string
          created_at?: string
          documents?: Json
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          points_possible?: number | null
          position?: number
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          assessment_type?: string
          content?: Json
          course_blueprint_id?: string
          created_at?: string
          documents?: Json
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          points_possible?: number | null
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_assessments_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_assignments: {
        Row: {
          artifact_id: string
          course_blueprint_id: string
          created_at: string
          default_due_days: number
          default_due_time: string
          gradebook_weight: number
          id: string
          include_in_final: boolean
          instructions_markdown: string
          is_draft: boolean
          points_possible: number | null
          position: number
          submission_requirements_json: Json
          title: string
          track_authenticity: boolean
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          course_blueprint_id: string
          created_at?: string
          default_due_days?: number
          default_due_time?: string
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          instructions_markdown?: string
          is_draft?: boolean
          points_possible?: number | null
          position?: number
          submission_requirements_json?: Json
          title: string
          track_authenticity?: boolean
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          course_blueprint_id?: string
          created_at?: string
          default_due_days?: number
          default_due_time?: string
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          instructions_markdown?: string
          is_draft?: boolean
          points_possible?: number | null
          position?: number
          submission_requirements_json?: Json
          title?: string
          track_authenticity?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_assignments_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_change_proposals: {
        Row: {
          applied_at: string | null
          applied_blueprint_revision: number | null
          applied_classroom_revision: number | null
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          course_blueprint_id: string
          created_at: string
          diff_json: Json
          id: string
          idempotency_key: string
          operations_json: Json
          payload_schema_version: number
          rejected_at: string | null
          request_sha256: string
          source_classroom_id: string | null
          source_kind: string
          status: string
          target_classroom_id: string | null
          target_kind: string
          teacher_id: string
          updated_at: string
          validation_errors: Json
        }
        Insert: {
          applied_at?: string | null
          applied_blueprint_revision?: number | null
          applied_classroom_revision?: number | null
          base_blueprint_revision: number
          base_blueprint_version_id?: string | null
          base_classroom_revision?: number | null
          course_blueprint_id: string
          created_at?: string
          diff_json?: Json
          id?: string
          idempotency_key: string
          operations_json?: Json
          payload_schema_version?: number
          rejected_at?: string | null
          request_sha256: string
          source_classroom_id?: string | null
          source_kind: string
          status?: string
          target_classroom_id?: string | null
          target_kind: string
          teacher_id: string
          updated_at?: string
          validation_errors?: Json
        }
        Update: {
          applied_at?: string | null
          applied_blueprint_revision?: number | null
          applied_classroom_revision?: number | null
          base_blueprint_revision?: number
          base_blueprint_version_id?: string | null
          base_classroom_revision?: number | null
          course_blueprint_id?: string
          created_at?: string
          diff_json?: Json
          id?: string
          idempotency_key?: string
          operations_json?: Json
          payload_schema_version?: number
          rejected_at?: string | null
          request_sha256?: string
          source_classroom_id?: string | null
          source_kind?: string
          status?: string
          target_classroom_id?: string | null
          target_kind?: string
          teacher_id?: string
          updated_at?: string
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_change_proposal_base_blueprint_version_id_fkey"
            columns: ["base_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_change_proposals_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_change_proposals_source_classroom_id_fkey"
            columns: ["source_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_change_proposals_target_classroom_id_fkey"
            columns: ["target_classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_change_proposals_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_editing_sessions: {
        Row: {
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          classroom_id: string | null
          closed_at: string | null
          course_blueprint_id: string
          created_at: string
          expires_at: string
          id: string
          package_sha256: string
          status: string
          teacher_id: string
        }
        Insert: {
          base_blueprint_revision: number
          base_blueprint_version_id?: string | null
          base_classroom_revision?: number | null
          classroom_id?: string | null
          closed_at?: string | null
          course_blueprint_id: string
          created_at?: string
          expires_at: string
          id?: string
          package_sha256: string
          status?: string
          teacher_id: string
        }
        Update: {
          base_blueprint_revision?: number
          base_blueprint_version_id?: string | null
          base_classroom_revision?: number | null
          classroom_id?: string | null
          closed_at?: string | null
          course_blueprint_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          package_sha256?: string
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_editing_session_base_blueprint_version_id_fkey"
            columns: ["base_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_editing_sessions_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_editing_sessions_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_editing_sessions_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_lesson_templates: {
        Row: {
          artifact_id: string
          content_markdown: string
          course_blueprint_id: string
          created_at: string
          id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          content_markdown?: string
          course_blueprint_id: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          content_markdown?: string
          course_blueprint_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_lesson_templates_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_materials: {
        Row: {
          artifact_id: string
          content_markdown: string
          course_blueprint_id: string
          created_at: string
          id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          content_markdown?: string
          course_blueprint_id: string
          created_at?: string
          id?: string
          position?: number
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          content_markdown?: string
          course_blueprint_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_materials_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_operations: {
        Row: {
          attempt_count: number
          completed_at: string | null
          error_code: string | null
          error_sqlstate: string | null
          id: string
          operation_type: string
          request_sha256: string
          resource_counts: Json
          result: Json | null
          result_blueprint_id: string | null
          result_classroom_id: string | null
          source_blueprint_id: string | null
          source_classroom_id: string | null
          started_at: string
          status: string
          teacher_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          error_code?: string | null
          error_sqlstate?: string | null
          id: string
          operation_type: string
          request_sha256: string
          resource_counts?: Json
          result?: Json | null
          result_blueprint_id?: string | null
          result_classroom_id?: string | null
          source_blueprint_id?: string | null
          source_classroom_id?: string | null
          started_at?: string
          status: string
          teacher_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          error_code?: string | null
          error_sqlstate?: string | null
          id?: string
          operation_type?: string
          request_sha256?: string
          resource_counts?: Json
          result?: Json | null
          result_blueprint_id?: string | null
          result_classroom_id?: string | null
          source_blueprint_id?: string | null
          source_classroom_id?: string | null
          started_at?: string
          status?: string
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_operations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_purge_fences: {
        Row: {
          course_blueprint_id: string
          installed_at: string
          operation_id: string
        }
        Insert: {
          course_blueprint_id: string
          installed_at?: string
          operation_id: string
        }
        Update: {
          course_blueprint_id?: string
          installed_at?: string
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_purge_fences_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "course_blueprint_purge_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_purge_objects: {
        Row: {
          attempt_count: number
          created_at: string
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_storage_object_id: string
          next_attempt_at?: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path?: string | null
          storage_path_sha256: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_storage_object_id?: string
          next_attempt_at?: string
          operation_id?: string
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          storage_path_sha256?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_purge_objects_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_purge_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_purge_operations: {
        Row: {
          attempt_count: number
          completed_at: string | null
          course_blueprint_id: string
          course_blueprint_title: string | null
          error_code: string | null
          finalization_sha256: string
          id: string
          impact_summary: Json
          inventory_completed_at: string | null
          inventory_sha256: string
          request_sha256: string
          resource_counts: Json
          retryable: boolean | null
          source_revision: number
          started_at: string
          status: string
          storage_object_count: number
          teacher_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          course_blueprint_id: string
          course_blueprint_title?: string | null
          error_code?: string | null
          finalization_sha256: string
          id: string
          impact_summary?: Json
          inventory_completed_at?: string | null
          inventory_sha256: string
          request_sha256: string
          resource_counts?: Json
          retryable?: boolean | null
          source_revision: number
          started_at?: string
          status: string
          storage_object_count?: number
          teacher_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          course_blueprint_id?: string
          course_blueprint_title?: string | null
          error_code?: string | null
          finalization_sha256?: string
          id?: string
          impact_summary?: Json
          inventory_completed_at?: string | null
          inventory_sha256?: string
          request_sha256?: string
          resource_counts?: Json
          retryable?: boolean | null
          source_revision?: number
          started_at?: string
          status?: string
          storage_object_count?: number
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_purge_operations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_purge_settings: {
        Row: {
          canary_blueprint_id: string | null
          canary_teacher_id: string | null
          rollout_mode: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          canary_blueprint_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          canary_blueprint_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_purge_settings_canary_teacher_id_fkey"
            columns: ["canary_teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_surveys: {
        Row: {
          artifact_id: string
          course_blueprint_id: string
          created_at: string
          dynamic_responses: boolean
          id: string
          position: number
          questions_json: Json
          show_results: boolean
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          course_blueprint_id: string
          created_at?: string
          dynamic_responses?: boolean
          id?: string
          position?: number
          questions_json?: Json
          show_results?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          course_blueprint_id?: string
          created_at?: string
          dynamic_responses?: boolean
          id?: string
          position?: number
          questions_json?: Json
          show_results?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_surveys_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_versions: {
        Row: {
          course_blueprint_id: string
          created_at: string
          created_by: string
          id: string
          snapshot_json: Json
          snapshot_schema_version: number
          snapshot_sha256: string
          source_draft_revision: number
          source_kind: string
          source_metadata: Json
          version_number: number
        }
        Insert: {
          course_blueprint_id: string
          created_at?: string
          created_by: string
          id?: string
          snapshot_json: Json
          snapshot_schema_version?: number
          snapshot_sha256: string
          source_draft_revision: number
          source_kind?: string
          source_metadata?: Json
          version_number: number
        }
        Update: {
          course_blueprint_id?: string
          created_at?: string
          created_by?: string
          id?: string
          snapshot_json?: Json
          snapshot_schema_version?: number
          snapshot_sha256?: string
          source_draft_revision?: number
          source_kind?: string
          source_metadata?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_versions_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprints: {
        Row: {
          authority_mode: string
          content_revision: number
          course_code: string
          created_at: string
          grade_level: string
          gradebook_assignments_weight: number
          gradebook_tests_weight: number
          gradebook_use_weights: boolean
          id: string
          latest_version_number: number
          outline_markdown: string
          overview_markdown: string
          planned_site_config: Json
          planned_site_published: boolean
          planned_site_slug: string | null
          position: number
          resources_markdown: string
          subject: string
          teacher_id: string
          term_template: string
          title: string
          updated_at: string
        }
        Insert: {
          authority_mode?: string
          content_revision?: number
          course_code?: string
          created_at?: string
          grade_level?: string
          gradebook_assignments_weight?: number
          gradebook_tests_weight?: number
          gradebook_use_weights?: boolean
          id?: string
          latest_version_number?: number
          outline_markdown?: string
          overview_markdown?: string
          planned_site_config?: Json
          planned_site_published?: boolean
          planned_site_slug?: string | null
          position?: number
          resources_markdown?: string
          subject?: string
          teacher_id: string
          term_template?: string
          title: string
          updated_at?: string
        }
        Update: {
          authority_mode?: string
          content_revision?: number
          course_code?: string
          created_at?: string
          grade_level?: string
          gradebook_assignments_weight?: number
          gradebook_tests_weight?: number
          gradebook_use_weights?: boolean
          id?: string
          latest_version_number?: number
          outline_markdown?: string
          overview_markdown?: string
          planned_site_config?: Json
          planned_site_published?: boolean
          planned_site_slug?: string | null
          position?: number
          resources_markdown?: string
          subject?: string
          teacher_id?: string
          term_template?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprints_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      course_guide_import_rate_limits: {
        Row: {
          active_lease_expires_at: string | null
          active_lease_token: string | null
          attempt_count: number
          attempt_timestamps: string[]
          teacher_id: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          active_lease_expires_at?: string | null
          active_lease_token?: string | null
          attempt_count: number
          attempt_timestamps: string[]
          teacher_id: string
          updated_at?: string
          window_started_at: string
        }
        Update: {
          active_lease_expires_at?: string | null
          active_lease_token?: string | null
          attempt_count?: number
          attempt_timestamps?: string[]
          teacher_id?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_guide_import_rate_limits_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_feedback_candidates: {
        Row: {
          affected_area: string | null
          approved_at: string | null
          completed_at: string | null
          confidence: number
          created_at: string
          dedupe_key: string
          direct_feedback_category: string | null
          dismissed_at: string | null
          first_seen_at: string
          id: string
          implementation_hint: string | null
          last_seen_at: string
          last_seen_date: string | null
          model: string | null
          original_request: string
          pr_url: string | null
          refined_request: string
          signal_count: number
          source_classroom_ids: string[]
          source_dates: string[]
          source_entry_count: number
          source_keys: string[]
          source_metadata: Json
          source_type: string
          started_at: string | null
          status: string
          status_note: string | null
          status_updated_at: string
          submitter_role: string | null
          submitter_user_id: string | null
          suggested_agent: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_area?: string | null
          approved_at?: string | null
          completed_at?: string | null
          confidence?: number
          created_at?: string
          dedupe_key: string
          direct_feedback_category?: string | null
          dismissed_at?: string | null
          first_seen_at?: string
          id?: string
          implementation_hint?: string | null
          last_seen_at?: string
          last_seen_date?: string | null
          model?: string | null
          original_request: string
          pr_url?: string | null
          refined_request: string
          signal_count?: number
          source_classroom_ids?: string[]
          source_dates?: string[]
          source_entry_count?: number
          source_keys?: string[]
          source_metadata?: Json
          source_type?: string
          started_at?: string | null
          status?: string
          status_note?: string | null
          status_updated_at?: string
          submitter_role?: string | null
          submitter_user_id?: string | null
          suggested_agent?: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_area?: string | null
          approved_at?: string | null
          completed_at?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string
          direct_feedback_category?: string | null
          dismissed_at?: string | null
          first_seen_at?: string
          id?: string
          implementation_hint?: string | null
          last_seen_at?: string
          last_seen_date?: string | null
          model?: string | null
          original_request?: string
          pr_url?: string | null
          refined_request?: string
          signal_count?: number
          source_classroom_ids?: string[]
          source_dates?: string[]
          source_entry_count?: number
          source_keys?: string[]
          source_metadata?: Json
          source_type?: string
          started_at?: string | null
          status?: string
          status_note?: string | null
          status_updated_at?: string
          submitter_role?: string | null
          submitter_user_id?: string | null
          suggested_agent?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_feedback_candidates_submitter_user_id_fkey"
            columns: ["submitter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entries: {
        Row: {
          classroom_id: string
          created_at: string
          date: string
          id: string
          minutes_reported: number | null
          mood: string | null
          on_time: boolean
          rich_content: Json | null
          student_id: string
          text: string
          updated_at: string
          version: number
        }
        Insert: {
          classroom_id: string
          created_at?: string
          date: string
          id?: string
          minutes_reported?: number | null
          mood?: string | null
          on_time: boolean
          rich_content?: Json | null
          student_id: string
          text: string
          updated_at?: string
          version?: number
        }
        Update: {
          classroom_id?: string
          created_at?: string
          date?: string
          id?: string
          minutes_reported?: number | null
          mood?: string | null
          on_time?: boolean
          rich_content?: Json | null
          student_id?: string
          text?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "entries_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gradebook_categories: {
        Row: {
          classroom_id: string
          created_at: string
          default_assessment_weight: number
          id: string
          is_default: boolean
          name: string
          percentage: number
          position: number
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          default_assessment_weight?: number
          id?: string
          is_default?: boolean
          name: string
          percentage: number
          position?: number
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          default_assessment_weight?: number
          id?: string
          is_default?: boolean
          name?: string
          percentage?: number
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gradebook_categories_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      gradebook_settings: {
        Row: {
          assignments_weight: number
          classroom_id: string
          created_at: string
          tests_weight: number
          updated_at: string
          use_weights: boolean
        }
        Insert: {
          assignments_weight?: number
          classroom_id: string
          created_at?: string
          tests_weight?: number
          updated_at?: string
          use_weights?: boolean
        }
        Update: {
          assignments_weight?: number
          classroom_id?: string
          created_at?: string
          tests_weight?: number
          updated_at?: string
          use_weights?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "gradebook_settings_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: true
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_plan_mutation_heads: {
        Row: {
          classroom_id: string
          client_id: string
          date: string
          last_sequence: number
          updated_at: string
        }
        Insert: {
          classroom_id: string
          client_id: string
          date: string
          last_sequence: number
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          client_id?: string
          date?: string
          last_sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_plan_mutation_heads_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_plans: {
        Row: {
          artifact_id: string
          blueprint_archived_at: string | null
          classroom_id: string
          content: Json
          content_markdown: string | null
          created_at: string
          date: string
          id: string
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id: string
          content?: Json
          content_markdown?: string | null
          created_at?: string
          date: string
          id?: string
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id?: string
          content?: Json
          content_markdown?: string | null
          created_at?: string
          date?: string
          id?: string
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_plans_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_plans_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      log_summaries: {
        Row: {
          classroom_id: string
          created_at: string
          date: string
          entries_updated_at: string | null
          entry_count: number
          generated_at: string
          id: string
          initials_map: Json
          model: string
          summary_items: Json
        }
        Insert: {
          classroom_id: string
          created_at?: string
          date: string
          entries_updated_at?: string | null
          entry_count?: number
          generated_at?: string
          id?: string
          initials_map?: Json
          model: string
          summary_items?: Json
        }
        Update: {
          classroom_id?: string
          created_at?: string
          date?: string
          entries_updated_at?: string | null
          entry_count?: number
          generated_at?: string
          id?: string
          initials_map?: Json
          model?: string
          summary_items?: Json
        }
        Relationships: [
          {
            foreignKeyName: "log_summaries_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_storage_json_references: {
        Row: {
          assignment_doc_history_id: string | null
          assignment_doc_id: string | null
          course_blueprint_assessment_id: string | null
          course_blueprint_change_proposal_id: string | null
          course_blueprint_version_id: string | null
          created_at: string
          evidence_sha256: string
          id: string
          managed_object_id: string
          reference_role: string
          storage_bucket: string
          storage_path: string
          test_id: string | null
        }
        Insert: {
          assignment_doc_history_id?: string | null
          assignment_doc_id?: string | null
          course_blueprint_assessment_id?: string | null
          course_blueprint_change_proposal_id?: string | null
          course_blueprint_version_id?: string | null
          created_at?: string
          evidence_sha256: string
          id?: string
          managed_object_id: string
          reference_role: string
          storage_bucket: string
          storage_path: string
          test_id?: string | null
        }
        Update: {
          assignment_doc_history_id?: string | null
          assignment_doc_id?: string | null
          course_blueprint_assessment_id?: string | null
          course_blueprint_change_proposal_id?: string | null
          course_blueprint_version_id?: string | null
          created_at?: string
          evidence_sha256?: string
          id?: string
          managed_object_id?: string
          reference_role?: string
          storage_bucket?: string
          storage_path?: string
          test_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_storage_json_referenc_course_blueprint_assessment__fkey"
            columns: ["course_blueprint_assessment_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_json_referenc_course_blueprint_change_prop_fkey"
            columns: ["course_blueprint_change_proposal_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_change_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_json_reference_course_blueprint_version_id_fkey"
            columns: ["course_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_json_reference_identity_fkey"
            columns: ["managed_object_id", "storage_bucket", "storage_path"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id", "storage_bucket", "storage_path"]
          },
          {
            foreignKeyName: "managed_storage_json_references_assignment_doc_history_id_fkey"
            columns: ["assignment_doc_history_id"]
            isOneToOne: false
            referencedRelation: "assignment_doc_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_json_references_assignment_doc_id_fkey"
            columns: ["assignment_doc_id"]
            isOneToOne: false
            referencedRelation: "assignment_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_json_references_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_json_references_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_storage_objects: {
        Row: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          attempt_count?: number
          byte_size?: number | null
          classroom_id?: string | null
          cleanup_reason_code?: string | null
          content_sha256?: string | null
          content_type?: string | null
          course_blueprint_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          data_subject_user_id?: string | null
          deleted_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          provisional_owner_id?: string | null
          purpose: string
          ready_at?: string | null
          reservation_expires_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          status?: string
          storage_bucket: string
          storage_path: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          attempt_count?: number
          byte_size?: number | null
          classroom_id?: string | null
          cleanup_reason_code?: string | null
          content_sha256?: string | null
          content_type?: string | null
          course_blueprint_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          data_subject_user_id?: string | null
          deleted_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          provisional_owner_id?: string | null
          purpose?: string
          ready_at?: string | null
          reservation_expires_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          status?: string
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_storage_objects_course_blueprint_id_fkey"
            columns: ["course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_objects_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_objects_data_subject_user_id_fkey"
            columns: ["data_subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_objects_provisional_owner_id_fkey"
            columns: ["provisional_owner_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_provisional_owners"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_storage_provisional_owners: {
        Row: {
          adopted_at: string | null
          copy_close_reason: string | null
          copy_closed_at: string | null
          created_at: string
          created_by_user_id: string
          expires_at: string
          id: string
          operation_id: string | null
          owner_kind: string
          source_course_blueprint_id: string | null
          target_classroom_id: string | null
          target_course_blueprint_id: string | null
        }
        Insert: {
          adopted_at?: string | null
          copy_close_reason?: string | null
          copy_closed_at?: string | null
          created_at?: string
          created_by_user_id: string
          expires_at: string
          id?: string
          operation_id?: string | null
          owner_kind: string
          source_course_blueprint_id?: string | null
          target_classroom_id?: string | null
          target_course_blueprint_id?: string | null
        }
        Update: {
          adopted_at?: string | null
          copy_close_reason?: string | null
          copy_closed_at?: string | null
          created_at?: string
          created_by_user_id?: string
          expires_at?: string
          id?: string
          operation_id?: string | null
          owner_kind?: string
          source_course_blueprint_id?: string | null
          target_classroom_id?: string | null
          target_course_blueprint_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_storage_provisional_own_source_course_blueprint_id_fkey"
            columns: ["source_course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_provisional_own_target_course_blueprint_id_fkey"
            columns: ["target_course_blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_storage_provisional_owners_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_storage_readiness_findings: {
        Row: {
          bucket: string | null
          created_at: string
          evidence_count: number
          finding_code: string
          id: number
          identity_sha256: string
          run_id: string
        }
        Insert: {
          bucket?: string | null
          created_at?: string
          evidence_count?: number
          finding_code: string
          id?: never
          identity_sha256: string
          run_id: string
        }
        Update: {
          bucket?: string | null
          created_at?: string
          evidence_count?: number
          finding_code?: string
          id?: never
          identity_sha256?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_storage_readiness_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_readiness_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_storage_readiness_runs: {
        Row: {
          completed_at: string | null
          finding_count: number
          generation: number
          id: string
          inventory_digest: string | null
          object_count: number
          protocol_version: number
          reference_count: number
          started_at: string
          status: string
          writer_revision: number | null
        }
        Insert: {
          completed_at?: string | null
          finding_count?: number
          generation: number
          id?: string
          inventory_digest?: string | null
          object_count?: number
          protocol_version: number
          reference_count?: number
          started_at?: string
          status: string
          writer_revision?: number | null
        }
        Update: {
          completed_at?: string | null
          finding_count?: number
          generation?: number
          id?: string
          inventory_digest?: string | null
          object_count?: number
          protocol_version?: number
          reference_count?: number
          started_at?: string
          status?: string
          writer_revision?: number | null
        }
        Relationships: []
      }
      managed_storage_settings: {
        Row: {
          activated_at: string | null
          mode: string
          protocol_version: number
          readiness_digest: string | null
          readiness_generation: number
          readiness_verified_at: string | null
          readiness_writer_revision: number | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          mode?: string
          protocol_version?: number
          readiness_digest?: string | null
          readiness_generation?: number
          readiness_verified_at?: string | null
          readiness_writer_revision?: number | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          mode?: string
          protocol_version?: number
          readiness_digest?: string | null
          readiness_generation?: number
          readiness_verified_at?: string | null
          readiness_writer_revision?: number | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      pal_daily_log_week_configurations: {
        Row: {
          config_version: number
          configured_at: string
          created_at: string
          eligible_days: number
          id: string
          period_key: string
          period_status: string
          student_id: string
        }
        Insert: {
          config_version: number
          configured_at: string
          created_at?: string
          eligible_days: number
          id?: string
          period_key: string
          period_status: string
          student_id: string
        }
        Update: {
          config_version?: number
          configured_at?: string
          created_at?: string
          eligible_days?: number
          id?: string
          period_key?: string
          period_status?: string
          student_id?: string
        }
        Relationships: []
      }
      pal_event_outbox: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json
          source_id: string
          source_kind: string
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payload: Json
          source_id: string
          source_kind: string
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          last_error_detail?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payload?: Json
          source_id?: string
          source_kind?: string
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_card_rows: {
        Row: {
          created_at: string
          final_percent: number
          id: string
          report_card_id: string
          student_id: string
          teacher_comment: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          final_percent: number
          id?: string
          report_card_id: string
          student_id: string
          teacher_comment?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          final_percent?: number
          id?: string
          report_card_id?: string
          student_id?: string
          teacher_comment?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_card_rows_report_card_id_fkey"
            columns: ["report_card_id"]
            isOneToOne: false
            referencedRelation: "report_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_card_rows_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      report_cards: {
        Row: {
          classroom_id: string
          created_at: string
          created_by: string
          id: string
          locked_at: string | null
          term: string
          updated_at: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          created_by: string
          id?: string
          locked_at?: string | null
          term: string
          updated_at?: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          created_by?: string
          id?: string
          locked_at?: string | null
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_cards_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_profiles: {
        Row: {
          created_at: string
          first_name: string
          id: string
          last_name: string
          student_number: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          first_name: string
          id?: string
          last_name: string
          student_number?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          student_number?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_purge_fences: {
        Row: {
          classroom_id: string
          created_at: string
          operation_id: string
          student_id: string
          teacher_id: string
        }
        Insert: {
          classroom_id: string
          created_at?: string
          operation_id: string
          student_id: string
          teacher_id: string
        }
        Update: {
          classroom_id?: string
          created_at?: string
          operation_id?: string
          student_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_purge_fences_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_purge_fences_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "student_purge_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_purge_fences_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_purge_fences_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_purge_objects: {
        Row: {
          attempt_count: number
          created_at: string
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_storage_object_id?: string | null
          next_attempt_at?: string
          operation_id: string
          status?: string
          storage_bucket: string
          storage_path?: string | null
          storage_path_sha256: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_storage_object_id?: string | null
          next_attempt_at?: string
          operation_id?: string
          status?: string
          storage_bucket?: string
          storage_path?: string | null
          storage_path_sha256?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_purge_objects_managed_storage_object_id_fkey"
            columns: ["managed_storage_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_purge_objects_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "student_purge_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      student_purge_operations: {
        Row: {
          attempt_count: number
          classroom_id: string
          completed_at: string | null
          error_code: string | null
          id: string
          impact_summary: Json
          inventory_completed_at: string | null
          request_sha256: string
          resource_counts: Json
          retryable: boolean | null
          source_revision: number
          started_at: string
          status: string
          storage_object_counts: Json
          student_binding_sha256: string
          student_email: string | null
          student_id: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          classroom_id: string
          completed_at?: string | null
          error_code?: string | null
          id: string
          impact_summary?: Json
          inventory_completed_at?: string | null
          request_sha256: string
          resource_counts?: Json
          retryable?: boolean | null
          source_revision: number
          started_at?: string
          status?: string
          storage_object_counts?: Json
          student_binding_sha256: string
          student_email?: string | null
          student_id?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          classroom_id?: string
          completed_at?: string | null
          error_code?: string | null
          id?: string
          impact_summary?: Json
          inventory_completed_at?: string | null
          request_sha256?: string
          resource_counts?: Json
          retryable?: boolean | null
          source_revision?: number
          started_at?: string
          status?: string
          storage_object_counts?: Json
          student_binding_sha256?: string
          student_email?: string | null
          student_id?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_purge_operations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_purge_operations_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      student_purge_resources: {
        Row: {
          disposition: string
          operation_id: string
          row_id: string
          table_name: string
        }
        Insert: {
          disposition: string
          operation_id: string
          row_id: string
          table_name: string
        }
        Update: {
          disposition?: string
          operation_id?: string
          row_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_purge_resources_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "student_purge_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      student_purge_settings: {
        Row: {
          canary_classroom_id: string | null
          canary_student_id: string | null
          canary_teacher_id: string | null
          rollout_mode: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          canary_classroom_id?: string | null
          canary_student_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          canary_classroom_id?: string | null
          canary_student_id?: string | null
          canary_teacher_id?: string | null
          rollout_mode?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_purge_settings_canary_student_id_fkey"
            columns: ["canary_student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_purge_settings_canary_teacher_id_fkey"
            columns: ["canary_teacher_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_questions: {
        Row: {
          artifact_id: string
          created_at: string
          id: string
          options: Json
          position: number
          question_text: string
          question_type: string
          response_max_chars: number
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          survey_id: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          created_at?: string
          id?: string
          options?: Json
          position?: number
          question_text: string
          question_type?: string
          response_max_chars?: number
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          survey_id: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          created_at?: string
          id?: string
          options?: Json
          position?: number
          question_text?: string
          question_type?: string
          response_max_chars?: number
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          survey_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_questions_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          id: string
          question_id: string
          response_text: string | null
          selected_option: number | null
          student_id: string
          submitted_at: string
          survey_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          question_id: string
          response_text?: string | null
          selected_option?: number | null
          student_id: string
          submitted_at?: string
          survey_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          question_id?: string
          response_text?: string | null
          selected_option?: number | null
          student_id?: string
          submitted_at?: string
          survey_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          artifact_id: string
          blueprint_archived_at: string | null
          classroom_id: string
          created_at: string
          created_by: string
          dynamic_responses: boolean
          id: string
          opens_at: string | null
          position: number
          show_results: boolean
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id: string
          created_at?: string
          created_by: string
          dynamic_responses?: boolean
          id?: string
          opens_at?: string | null
          position: number
          show_results?: boolean
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id?: string
          created_at?: string
          created_by?: string
          dynamic_responses?: boolean
          id?: string
          opens_at?: string | null
          position?: number
          show_results?: boolean
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      test_ai_grading_run_items: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          next_retry_at: string | null
          question_grading_snapshot: Json | null
          question_id: string
          queue_position: number
          response_id: string
          response_revision: number
          run_id: string
          started_at: string | null
          status: string
          student_id: string
          test_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_retry_at?: string | null
          question_grading_snapshot?: Json | null
          question_id: string
          queue_position?: number
          response_id: string
          response_revision: number
          run_id: string
          started_at?: string | null
          status?: string
          student_id: string
          test_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_retry_at?: string | null
          question_grading_snapshot?: Json | null
          question_id?: string
          queue_position?: number
          response_id?: string
          response_revision?: number
          run_id?: string
          started_at?: string | null
          status?: string
          student_id?: string
          test_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_ai_grading_run_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "test_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_ai_grading_run_items_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "test_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_ai_grading_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "test_ai_grading_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_ai_grading_run_items_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_ai_grading_run_items_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_ai_grading_runs: {
        Row: {
          completed_at: string | null
          completed_count: number
          created_at: string
          eligible_student_count: number
          error_samples_json: Json
          failed_count: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          model: string | null
          processed_count: number
          prompt_guideline_override: string | null
          queued_response_count: number
          requested_count: number
          requested_student_ids_json: Json
          selection_hash: string
          skipped_already_graded_count: number
          skipped_unanswered_count: number
          started_at: string | null
          status: string
          test_id: string
          triggered_by: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          eligible_student_count?: number
          error_samples_json?: Json
          failed_count?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model?: string | null
          processed_count?: number
          prompt_guideline_override?: string | null
          queued_response_count?: number
          requested_count?: number
          requested_student_ids_json?: Json
          selection_hash: string
          skipped_already_graded_count?: number
          skipped_unanswered_count?: number
          started_at?: string | null
          status?: string
          test_id: string
          triggered_by: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          eligible_student_count?: number
          error_samples_json?: Json
          failed_count?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          model?: string | null
          processed_count?: number
          prompt_guideline_override?: string | null
          queued_response_count?: number
          requested_count?: number
          requested_student_ids_json?: Json
          selection_hash?: string
          skipped_already_graded_count?: number
          skipped_unanswered_count?: number
          started_at?: string | null
          status?: string
          test_id?: string
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_ai_grading_runs_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_ai_grading_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      test_attempt_history: {
        Row: {
          char_count: number
          created_at: string
          id: string
          keystroke_count: number
          paste_word_count: number
          patch: Json | null
          snapshot: Json | null
          test_attempt_id: string
          trigger: string
          word_count: number
        }
        Insert: {
          char_count?: number
          created_at?: string
          id?: string
          keystroke_count?: number
          paste_word_count?: number
          patch?: Json | null
          snapshot?: Json | null
          test_attempt_id: string
          trigger: string
          word_count?: number
        }
        Update: {
          char_count?: number
          created_at?: string
          id?: string
          keystroke_count?: number
          paste_word_count?: number
          patch?: Json | null
          snapshot?: Json | null
          test_attempt_id?: string
          trigger?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "test_attempt_history_test_attempt_id_fkey"
            columns: ["test_attempt_id"]
            isOneToOne: false
            referencedRelation: "test_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      test_attempts: {
        Row: {
          authenticity_flags: Json | null
          authenticity_score: number | null
          closed_for_grading_at: string | null
          closed_for_grading_by: string | null
          created_at: string
          id: string
          is_submitted: boolean
          responses: Json
          returned_at: string | null
          returned_by: string | null
          student_id: string
          submitted_at: string | null
          test_id: string
          updated_at: string
        }
        Insert: {
          authenticity_flags?: Json | null
          authenticity_score?: number | null
          closed_for_grading_at?: string | null
          closed_for_grading_by?: string | null
          created_at?: string
          id?: string
          is_submitted?: boolean
          responses?: Json
          returned_at?: string | null
          returned_by?: string | null
          student_id: string
          submitted_at?: string | null
          test_id: string
          updated_at?: string
        }
        Update: {
          authenticity_flags?: Json | null
          authenticity_score?: number | null
          closed_for_grading_at?: string | null
          closed_for_grading_by?: string | null
          created_at?: string
          id?: string
          is_submitted?: boolean
          responses?: Json
          returned_at?: string | null
          returned_by?: string | null
          student_id?: string
          submitted_at?: string | null
          test_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_attempts_closed_for_grading_by_fkey"
            columns: ["closed_for_grading_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_attempts_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_attempts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_attempts_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_document_snapshot_storage_cleanup: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          status: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          status?: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          managed_object_id?: string | null
          next_attempt_at?: string
          status?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_document_snapshot_storage_cleanup_managed_object_id_fkey"
            columns: ["managed_object_id"]
            isOneToOne: false
            referencedRelation: "managed_storage_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      test_focus_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          occurred_at: string
          session_id: string
          student_id: string
          test_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          session_id: string
          student_id: string
          test_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          session_id?: string
          student_id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_focus_events_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_focus_events_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_questions: {
        Row: {
          ai_reference_cache_answers: Json | null
          ai_reference_cache_generated_at: string | null
          ai_reference_cache_key: string | null
          ai_reference_cache_model: string | null
          answer_key: string | null
          artifact_id: string
          correct_option: number | null
          created_at: string
          id: string
          options: Json
          points: number
          position: number
          question_text: string
          question_type: string
          response_max_chars: number
          response_monospace: boolean
          sample_solution: string | null
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          test_id: string
          updated_at: string
        }
        Insert: {
          ai_reference_cache_answers?: Json | null
          ai_reference_cache_generated_at?: string | null
          ai_reference_cache_key?: string | null
          ai_reference_cache_model?: string | null
          answer_key?: string | null
          artifact_id?: string
          correct_option?: number | null
          created_at?: string
          id?: string
          options?: Json
          points?: number
          position?: number
          question_text: string
          question_type?: string
          response_max_chars?: number
          response_monospace?: boolean
          sample_solution?: string | null
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          test_id: string
          updated_at?: string
        }
        Update: {
          ai_reference_cache_answers?: Json | null
          ai_reference_cache_generated_at?: string | null
          ai_reference_cache_key?: string | null
          ai_reference_cache_model?: string | null
          answer_key?: string | null
          artifact_id?: string
          correct_option?: number | null
          created_at?: string
          id?: string
          options?: Json
          points?: number
          position?: number
          question_text?: string
          question_type?: string
          response_max_chars?: number
          response_monospace?: boolean
          sample_solution?: string | null
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          test_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_questions_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_questions_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_responses: {
        Row: {
          ai_grading_basis: string | null
          ai_grading_provenance: Json | null
          ai_grading_review: Json | null
          ai_model: string | null
          ai_reference_answers: Json | null
          ai_suggested_feedback: string | null
          ai_suggested_score: number | null
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          question_id: string
          response_text: string | null
          revision: number
          score: number | null
          selected_option: number | null
          student_id: string
          submitted_at: string
          test_id: string
        }
        Insert: {
          ai_grading_basis?: string | null
          ai_grading_provenance?: Json | null
          ai_grading_review?: Json | null
          ai_model?: string | null
          ai_reference_answers?: Json | null
          ai_suggested_feedback?: string | null
          ai_suggested_score?: number | null
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          question_id: string
          response_text?: string | null
          revision?: number
          score?: number | null
          selected_option?: number | null
          student_id: string
          submitted_at?: string
          test_id: string
        }
        Update: {
          ai_grading_basis?: string | null
          ai_grading_provenance?: Json | null
          ai_grading_review?: Json | null
          ai_model?: string | null
          ai_reference_answers?: Json | null
          ai_suggested_feedback?: string | null
          ai_suggested_score?: number | null
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          question_id?: string
          response_text?: string | null
          revision?: number
          score?: number | null
          selected_option?: number | null
          student_id?: string
          submitted_at?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_responses_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "test_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_responses_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_responses_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_student_availability: {
        Row: {
          created_at: string
          id: string
          state: string
          student_id: string
          test_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          state: string
          student_id: string
          test_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          state?: string
          student_id?: string
          test_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_student_availability_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_student_availability_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_student_availability_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          artifact_id: string
          blueprint_archived_at: string | null
          classroom_id: string
          created_at: string
          created_by: string
          documents: Json
          gradebook_category_id: string | null
          gradebook_weight: number
          id: string
          include_in_final: boolean
          points_possible: number
          position: number
          questions_locked_at: string | null
          show_results: boolean
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id: string
          created_at?: string
          created_by: string
          documents?: Json
          gradebook_category_id?: string | null
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          points_possible?: number
          position?: number
          questions_locked_at?: string | null
          show_results?: boolean
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string
          blueprint_archived_at?: string | null
          classroom_id?: string
          created_at?: string
          created_by?: string
          documents?: Json
          gradebook_category_id?: string | null
          gradebook_weight?: number
          id?: string
          include_in_final?: boolean
          points_possible?: number
          position?: number
          questions_locked_at?: string | null
          show_results?: boolean
          source_artifact_id?: string | null
          source_blueprint_version_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tests_classroom_id_fkey"
            columns: ["classroom_id"]
            isOneToOne: false
            referencedRelation: "classrooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_gradebook_category_id_fkey"
            columns: ["gradebook_category_id"]
            isOneToOne: false
            referencedRelation: "gradebook_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tests_source_blueprint_version_id_fkey"
            columns: ["source_blueprint_version_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_github_identities: {
        Row: {
          commit_emails: string[]
          created_at: string
          github_login: string | null
          id: string
          updated_at: string
          user_id: string
          validated_at: string | null
          validation_message: string | null
          validation_status: string
        }
        Insert: {
          commit_emails?: string[]
          created_at?: string
          github_login?: string | null
          id?: string
          updated_at?: string
          user_id: string
          validated_at?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Update: {
          commit_emails?: string[]
          created_at?: string
          github_login?: string | null
          id?: string
          updated_at?: string
          user_id?: string
          validated_at?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_github_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_credential_version: number
          created_at: string
          email: string
          email_verified_at: string | null
          id: string
          password_hash: string | null
          role: string
          workos_user_id: string | null
        }
        Insert: {
          auth_credential_version?: number
          created_at?: string
          email: string
          email_verified_at?: string | null
          id?: string
          password_hash?: string | null
          role: string
          workos_user_id?: string | null
        }
        Update: {
          auth_credential_version?: number
          created_at?: string
          email?: string
          email_verified_at?: string | null
          id?: string
          password_hash?: string | null
          role?: string
          workos_user_id?: string | null
        }
        Relationships: []
      }
      verification_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          handoff_consumed_at: string | null
          handoff_expires_at: string | null
          handoff_token_hash: string | null
          id: string
          purpose: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          handoff_consumed_at?: string | null
          handoff_expires_at?: string | null
          handoff_token_hash?: string | null
          id?: string
          purpose: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          handoff_consumed_at?: string | null
          handoff_expires_at?: string | null
          handoff_token_hash?: string | null
          id?: string
          purpose?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_course_guide_import_extraction_slot: {
        Args: { p_teacher_id: string }
        Returns: Json
      }
      activate_managed_storage_enforcement: {
        Args: { p_generation: number; p_inventory_digest: string }
        Returns: boolean
      }
      activate_test_from_draft_atomic: {
        Args: {
          p_expected_draft_version: number
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      apply_archived_classroom_blueprint_proposal_atomic: {
        Args: {
          p_candidate_sha256: string
          p_candidate_snapshot: Json
          p_classroom_id: string
          p_expected_classroom_revision: number
          p_proposal_id: string
          p_result_snapshot_sha256: string
          p_teacher_id: string
        }
        Returns: {
          applied_at: string | null
          applied_blueprint_revision: number | null
          applied_classroom_revision: number | null
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          course_blueprint_id: string
          created_at: string
          diff_json: Json
          id: string
          idempotency_key: string
          operations_json: Json
          payload_schema_version: number
          rejected_at: string | null
          request_sha256: string
          source_classroom_id: string | null
          source_kind: string
          status: string
          target_classroom_id: string | null
          target_kind: string
          teacher_id: string
          updated_at: string
          validation_errors: Json
        }
        SetofOptions: {
          from: "*"
          to: "course_blueprint_change_proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_attendance_event_for_classroom_v1: {
        Args: {
          p_classroom_id: string
          p_event: Json
          p_teacher_id: string
          p_transport_nonce: string
        }
        Returns: Json
      }
      apply_attendance_event_for_entitled_mapping_v1: {
        Args: { p_event: Json; p_transport_nonce: string }
        Returns: Json
      }
      apply_attendance_event_v1: {
        Args: { p_event: Json; p_transport_nonce: string }
        Returns: Json
      }
      apply_attendance_session_snapshot_for_entitled_mapping_v1: {
        Args: { p_installation_ref: string; p_snapshot: Json }
        Returns: Json
      }
      apply_attendance_session_snapshot_v1: {
        Args: { p_installation_ref: string; p_snapshot: Json }
        Returns: Json
      }
      apply_attendance_status_overrides_v1: {
        Args: {
          p_class_date: string
          p_classroom_id: string
          p_marks: Json
          p_request_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      apply_course_blueprint_classroom_proposal_atomic: {
        Args: {
          p_classroom_plan: Json
          p_classroom_plan_sha256: string
          p_proposal_id: string
          p_teacher_id: string
        }
        Returns: {
          applied_at: string | null
          applied_blueprint_revision: number | null
          applied_classroom_revision: number | null
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          course_blueprint_id: string
          created_at: string
          diff_json: Json
          id: string
          idempotency_key: string
          operations_json: Json
          payload_schema_version: number
          rejected_at: string | null
          request_sha256: string
          source_classroom_id: string | null
          source_kind: string
          status: string
          target_classroom_id: string | null
          target_kind: string
          teacher_id: string
          updated_at: string
          validation_errors: Json
        }
        SetofOptions: {
          from: "*"
          to: "course_blueprint_change_proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_course_blueprint_proposal_atomic: {
        Args: {
          p_candidate_sha256: string
          p_candidate_snapshot: Json
          p_proposal_id: string
          p_teacher_id: string
        }
        Returns: {
          applied_at: string | null
          applied_blueprint_revision: number | null
          applied_classroom_revision: number | null
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          course_blueprint_id: string
          created_at: string
          diff_json: Json
          id: string
          idempotency_key: string
          operations_json: Json
          payload_schema_version: number
          rejected_at: string | null
          request_sha256: string
          source_classroom_id: string | null
          source_kind: string
          status: string
          target_classroom_id: string | null
          target_kind: string
          teacher_id: string
          updated_at: string
          validation_errors: Json
        }
        SetofOptions: {
          from: "*"
          to: "course_blueprint_change_proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_ordered_lesson_plan_mutation: {
        Args: {
          p_classroom_id: string
          p_client_id: string
          p_content: Json
          p_content_markdown: string
          p_date: string
          p_delete: boolean
          p_sequence: number
        }
        Returns: Json
      }
      archived_classroom_blueprint_snapshot_from_plan: {
        Args: { p_blueprint_id: string; p_draft_revision: number; p_plan: Json }
        Returns: Json
      }
      attendance_classroom_has_state_v1: {
        Args: { p_classroom_id: string }
        Returns: boolean
      }
      attendance_decommission_allowed: {
        Args: { p_classroom_id: string; p_teacher_id: string }
        Returns: boolean
      }
      attendance_event_v1_valid: { Args: { p_event: Json }; Returns: boolean }
      attendance_outbox_claim_allowed_v1: {
        Args: {
          p_at?: string
          p_row: Database["public"]["Tables"]["attendance_integration_outbox"]["Row"]
          p_teacher_id: string
        }
        Returns: boolean
      }
      attendance_outbox_dependencies_ready_v1: {
        Args: {
          p_row: Database["public"]["Tables"]["attendance_integration_outbox"]["Row"]
        }
        Returns: boolean
      }
      attendance_outbox_health_v1: { Args: never; Returns: Json }
      attendance_outbox_health_v2: {
        Args: { p_classroom_id: string; p_teacher_id: string }
        Returns: Json
      }
      attendance_outbox_health_v3: { Args: never; Returns: Json }
      attendance_roster_source_document_v1: {
        Args: { p_classroom_id: string }
        Returns: Json
      }
      attendance_schedule_source_document_v1: {
        Args: {
          p_classroom_id: string
          p_window_end: string
          p_window_start: string
        }
        Returns: Json
      }
      attendance_session_snapshot_v1_valid: {
        Args: { p_snapshot: Json }
        Returns: boolean
      }
      attendance_student_has_state_v1: {
        Args: { p_classroom_id: string; p_student_id: string }
        Returns: boolean
      }
      attendance_teacher_entitled_v1: {
        Args: { p_at?: string; p_teacher_id: string }
        Returns: boolean
      }
      authorize_attendance_decommission_advance: {
        Args: {
          p_classroom_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_attendance_decommission: {
        Args: {
          p_classroom_id: string
          p_confirmation: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_attendance_integration_smoke_v1: {
        Args: {
          p_challenge_hash: string
          p_classroom_id: string
          p_installation_ref: string
          p_request_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_archive_compaction: {
        Args: {
          p_archive_id: string
          p_classroom_id: string
          p_operation_id: string
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_archive_compaction_v2: {
        Args: {
          p_archive_id: string
          p_classroom_id: string
          p_operation_id: string
          p_request_sha256: string
          p_restore_contract_version: number
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_archive_export_v2: {
        Args: {
          p_archive_format_version: number
          p_classroom_id: string
          p_operation_id: string
          p_request_sha256: string
          p_retention: Json
          p_source_app_commit: string
          p_source_contract_version: number
          p_source_schema_migration: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_archive_export_v2_expected_revision: {
        Args: {
          p_archive_format_version: number
          p_classroom_id: string
          p_expected_source_revision: number
          p_operation_id: string
          p_request_sha256: string
          p_retention: Json
          p_source_app_commit: string
          p_source_contract_version: number
          p_source_schema_migration: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_archive_restore: {
        Args: {
          p_adapter_chain: Json
          p_archive_id: string
          p_classroom_id: string
          p_database_budget_bytes: number
          p_operation_id: string
          p_request_sha256: string
          p_resource_counts: Json
          p_storage_objects: Json
          p_target_schema_migration: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_archive_restore_v2: {
        Args: {
          p_adapter_chain: Json
          p_archive_id: string
          p_classroom_id: string
          p_database_budget_bytes: number
          p_operation_id: string
          p_request_sha256: string
          p_resource_counts: Json
          p_restore_contract_version: number
          p_source_contract_version: number
          p_source_resource_counts: Json
          p_storage_objects: Json
          p_target_schema_migration: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_classroom_gradex_extract: {
        Args: {
          p_classroom_id: string
          p_delete_after: string
          p_operation_id: string
          p_request_sha256: string
          p_source_archive_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_cleanup_history_cron_run: {
        Args: {
          p_deployment_id?: string
          p_invocation_source: string
          p_schedule?: string
        }
        Returns: Json
      }
      begin_cold_archived_classroom_purge: {
        Args: {
          p_archive_id: string
          p_classroom_id: string
          p_impact_summary: Json
          p_operation_id: string
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_course_blueprint_purge: {
        Args: {
          p_course_blueprint_id: string
          p_impact_summary: Json
          p_operation_id: string
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_hot_archived_classroom_purge: {
        Args: {
          p_classroom_id: string
          p_impact_summary: Json
          p_operation_id: string
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_managed_storage_blueprint_copy_owner: {
        Args: {
          p_created_by_user_id: string
          p_operation_id: string
          p_owner_id: string
          p_source_course_blueprint_id: string
        }
        Returns: boolean
      }
      begin_managed_storage_provisional_owner: {
        Args: {
          p_created_by_user_id: string
          p_operation_id: string
          p_owner_id: string
          p_owner_kind: string
          p_target_classroom_id?: string
          p_target_course_blueprint_id?: string
        }
        Returns: boolean
      }
      begin_managed_storage_upload: {
        Args: {
          p_byte_size: number
          p_classroom_id: string
          p_content_type: string
          p_course_blueprint_id: string
          p_created_by_user_id: string
          p_data_subject_user_id: string
          p_object_id: string
          p_provisional_owner_id: string
          p_purpose: string
          p_resource_id: string
          p_resource_type: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "managed_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_student_purge: {
        Args: {
          p_classroom_id: string
          p_confirmation: string
          p_expected_relational_inventory_sha256: string
          p_expected_source_revision: number
          p_expected_storage_inventory_sha256: string
          p_operation_id: string
          p_student_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      begin_student_purge_without_attendance_v1: {
        Args: {
          p_classroom_id: string
          p_confirmation: string
          p_expected_relational_inventory_sha256: string
          p_expected_source_revision: number
          p_expected_storage_inventory_sha256: string
          p_operation_id: string
          p_student_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      bind_classroom_archive_restore_managed_object: {
        Args: {
          p_managed_object_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      bind_managed_storage_operation_ledgers: {
        Args: {
          p_managed_object_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      claim_assignment_ai_grading_run: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_run_id: string
        }
        Returns: {
          assignment_id: string
          completed_at: string | null
          completed_count: number
          created_at: string
          error_samples_json: Json
          failed_count: number
          gradable_count: number
          gradex_last_polled_at: string | null
          gradex_run_id: string | null
          gradex_status: string | null
          gradex_submitted_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          model: string | null
          processed_count: number
          requested_count: number
          requested_student_ids_json: Json
          selection_hash: string
          skipped_empty_count: number
          skipped_missing_count: number
          started_at: string | null
          status: string
          triggered_by: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "assignment_ai_grading_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_assignment_artifact_storage_cleanup: {
        Args: {
          p_lease_seconds: number
          p_lease_token: string
          p_limit: number
        }
        Returns: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          status: string
          storage_path: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "assignment_artifact_storage_cleanup"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_assignment_artifact_storage_cleanup_path: {
        Args: {
          p_lease_seconds: number
          p_lease_token: string
          p_storage_path: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          status: string
          storage_path: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "assignment_artifact_storage_cleanup"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_attendance_outbound_message_v1: {
        Args: { p_idempotency_key: string; p_lease_seconds?: number }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_attendance_outbound_message_v2: {
        Args: {
          p_classroom_id: string
          p_idempotency_key: string
          p_lease_seconds?: number
          p_teacher_id: string
        }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_attendance_outbox_batch_v1: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_attendance_outbox_batch_v2: {
        Args: {
          p_classroom_id: string
          p_lease_seconds?: number
          p_limit?: number
          p_teacher_id: string
        }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_attendance_outbox_batch_v3: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_classroom_purge_object: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          delete_priority: number
          deleted_at: string | null
          disposition: string
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "classroom_purge_objects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_classroom_purge_object_v118: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          delete_priority: number
          deleted_at: string | null
          disposition: string
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "classroom_purge_objects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_cold_classroom_purge_object: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          delete_priority: number
          deleted_at: string | null
          disposition: string
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string | null
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "classroom_purge_objects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_course_blueprint_purge_object: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_storage_object_id: string
          next_attempt_at: string
          operation_id: string
          status: string
          storage_bucket: string
          storage_path: string | null
          storage_path_sha256: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "course_blueprint_purge_objects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_classroom_archive_object_upload_cleanup: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_limit?: number
        }
        Returns: {
          attempt_count: number
          operation_id: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      claim_due_classroom_archive_source_object_cleanup: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_limit?: number
          p_operation_id: string
        }
        Returns: {
          archive_id: string
          attempt_count: number
          classroom_id: string
          expected_byte_size: number
          expected_sha256: string
          operation_id: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      claim_due_classroom_archive_source_object_cleanup_v2: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_limit?: number
          p_operation_id: string
        }
        Returns: {
          archive_id: string
          attempt_count: number
          classroom_id: string
          expected_byte_size: number
          expected_sha256: string
          operation_id: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      claim_due_classroom_gradex_extract_cleanup: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_limit?: number
          p_operation_id: string
        }
        Returns: {
          attempt_count: number
          extract_id: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      claim_managed_storage_cleanup: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_limit?: number
        }
        Returns: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "managed_storage_objects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pal_event_outbox: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json
          source_id: string
          source_kind: string
          status: string
          student_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pal_event_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_student_purge_object: {
        Args: {
          p_lease_seconds?: number
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      claim_test_ai_grading_run: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_run_id: string
        }
        Returns: {
          completed_at: string | null
          completed_count: number
          created_at: string
          eligible_student_count: number
          error_samples_json: Json
          failed_count: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          model: string | null
          processed_count: number
          prompt_guideline_override: string | null
          queued_response_count: number
          requested_count: number
          requested_student_ids_json: Json
          selection_hash: string
          skipped_already_graded_count: number
          skipped_unanswered_count: number
          started_at: string | null
          status: string
          test_id: string
          triggered_by: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "test_ai_grading_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_test_document_snapshot_storage_cleanup: {
        Args: {
          p_lease_seconds: number
          p_lease_token: string
          p_limit: number
        }
        Returns: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          status: string
          storage_path: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "test_document_snapshot_storage_cleanup"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_test_document_snapshot_storage_cleanup_path: {
        Args: {
          p_lease_seconds: number
          p_lease_token: string
          p_storage_path: string
        }
        Returns: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          managed_object_id: string | null
          next_attempt_at: string
          status: string
          storage_path: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "test_document_snapshot_storage_cleanup"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      classroom_archive_source_object_path_sha256: {
        Args: { p_storage_bucket: string; p_storage_path: string }
        Returns: string
      }
      classroom_purge_conflict: {
        Args: { p_classroom_id: string }
        Returns: string
      }
      classroom_purge_lock: {
        Args: { p_classroom_id: string }
        Returns: undefined
      }
      classroom_purge_rollout_allows: {
        Args: { p_classroom_id: string; p_teacher_id: string }
        Returns: boolean
      }
      classroom_purge_storage_inventory_sha256: {
        Args: { p_classroom_id: string }
        Returns: string
      }
      classroom_purge_storage_path_is_shared: {
        Args: {
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      classroom_purge_try_lock: {
        Args: { p_classroom_id: string }
        Returns: boolean
      }
      cleanup_assignment_doc_save_operations: {
        Args: { p_completed_before: string }
        Returns: number
      }
      cleanup_expired_classroom_archive_snapshots: {
        Args: never
        Returns: number
      }
      cleanup_history_cron_metrics_valid: {
        Args: { p_metrics: Json }
        Returns: boolean
      }
      clear_auth_rate_limit: {
        Args: { p_key_hash: string; p_scope: string }
        Returns: boolean
      }
      clear_test_open_response_grades_atomic: {
        Args: {
          p_expected_responses: Json
          p_now: string
          p_student_ids: string[]
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      close_test_for_grading_atomic: {
        Args: { p_closed_by: string; p_test_id: string }
        Returns: Json
      }
      cold_classroom_purge_resource_inventory: {
        Args: { p_classroom_id: string }
        Returns: {
          identity_sha256: string
          resource_id: string
          resource_type: string
        }[]
      }
      cold_classroom_purge_resource_inventory_sha256: {
        Args: { p_classroom_id: string }
        Returns: string
      }
      cold_classroom_purge_rollout_allows: {
        Args: { p_classroom_id: string; p_teacher_id: string }
        Returns: boolean
      }
      complete_assignment_artifact_storage_cleanup: {
        Args: { p_cleanup_id: string; p_lease_token: string }
        Returns: boolean
      }
      complete_assignment_repo_review_run_atomic: {
        Args: {
          p_grade_rows: Json
          p_model: string
          p_now: string
          p_result_rows: Json
          p_run_id: string
          p_source_ref: string
          p_teacher_id: string
          p_warnings: Json
        }
        Returns: Json
      }
      complete_assignment_repo_review_run_with_provenance_atomic: {
        Args: {
          p_grade_rows: Json
          p_model: string
          p_now: string
          p_result_rows: Json
          p_run_id: string
          p_source_ref: string
          p_teacher_id: string
          p_warnings: Json
        }
        Returns: Json
      }
      complete_attendance_integration_smoke_v1: {
        Args: {
          p_bara_to_pika: boolean
          p_classroom_id: string
          p_error_code: string
          p_installation_ref: string
          p_passed: boolean
          p_pika_to_bara: boolean
          p_request_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      complete_attendance_outbox_v1: {
        Args: {
          p_lease_token: string
          p_outbox_id: string
          p_response_payload: Json
        }
        Returns: boolean
      }
      complete_attendance_outbox_v2: {
        Args: {
          p_lease_token: string
          p_outbox_id: string
          p_response_payload: Json
        }
        Returns: boolean
      }
      complete_classroom_archive_compaction: {
        Args: {
          p_actors: Json
          p_operation_id: string
          p_teacher_id: string
          p_verification: Json
        }
        Returns: Json
      }
      complete_classroom_archive_compaction_v2: {
        Args: {
          p_actors: Json
          p_operation_id: string
          p_restore_contract_version: number
          p_teacher_id: string
          p_verification: Json
        }
        Returns: Json
      }
      complete_classroom_archive_export_v2: {
        Args: {
          p_archive_format_version: number
          p_archive_resource_counts: Json
          p_artifact_sha256: string
          p_compressed_byte_size: number
          p_content_sha256: string
          p_operation_id: string
          p_resource_counts: Json
          p_storage_bucket: string
          p_storage_object_counts: Json
          p_storage_path: string
          p_teacher_id: string
          p_uncompressed_byte_size: number
          p_verification: Json
        }
        Returns: Json
      }
      complete_classroom_archive_object_upload_cleanup: {
        Args: {
          p_lease_token: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      complete_classroom_archive_restore: {
        Args: {
          p_operation_id: string
          p_teacher_id: string
          p_verification: Json
        }
        Returns: Json
      }
      complete_classroom_archive_restore_v2: {
        Args: {
          p_operation_id: string
          p_restore_contract_version: number
          p_teacher_id: string
          p_verification: Json
        }
        Returns: Json
      }
      complete_classroom_archive_source_object_cleanup: {
        Args: {
          p_lease_token: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      complete_classroom_gradex_extract: {
        Args: {
          p_artifact_sha256: string
          p_compressed_byte_size: number
          p_content_sha256: string
          p_operation_id: string
          p_resource_counts: Json
          p_teacher_id: string
          p_uncompressed_byte_size: number
          p_verification: Json
        }
        Returns: Json
      }
      complete_classroom_gradex_extract_cleanup: {
        Args: { p_extract_id: string; p_lease_token: string }
        Returns: boolean
      }
      complete_classroom_purge_object: {
        Args: {
          p_lease_token: string
          p_object_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      complete_course_blueprint_purge_object: {
        Args: {
          p_lease_token: string
          p_object_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      complete_managed_storage_cleanup: {
        Args: { p_lease_token: string; p_object_id: string }
        Returns: boolean
      }
      complete_pal_event_outbox: {
        Args: { p_lease_token: string; p_outbox_id: string }
        Returns: boolean
      }
      complete_student_purge_object: {
        Args: {
          p_lease_token: string
          p_object_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      complete_test_document_snapshot_storage_cleanup: {
        Args: { p_cleanup_id: string; p_lease_token: string }
        Returns: boolean
      }
      consume_attendance_integration_smoke_nonce_v1: {
        Args: {
          p_challenge_hash: string
          p_classroom_id: string
          p_direction: string
          p_installation_ref: string
          p_nonce: string
          p_request_timestamp: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      consume_auth_global_rate_limit: {
        Args: {
          p_key_hash: string
          p_max_attempts: number
          p_window_seconds: number
        }
        Returns: Json
      }
      consume_auth_rate_limit: {
        Args: {
          p_key_hash: string
          p_max_attempts: number
          p_scope: string
          p_window_seconds: number
        }
        Returns: Json
      }
      consume_password_reset_and_revoke_sessions: {
        Args: {
          p_handoff_token_hash: string
          p_password_hash: string
          p_user_id: string
        }
        Returns: number
      }
      count_pal_event_outbox_ready: { Args: never; Returns: number }
      course_blueprint_canonical_jsonb_text: {
        Args: { p_value: Json }
        Returns: string
      }
      course_blueprint_purge_conflict: {
        Args: { p_blueprint_id: string }
        Returns: string
      }
      course_blueprint_purge_enabled: {
        Args: { p_blueprint_id: string; p_teacher_id: string }
        Returns: boolean
      }
      course_blueprint_purge_lock: {
        Args: { p_blueprint_id: string }
        Returns: undefined
      }
      course_blueprint_purge_membership_sha256: {
        Args: { p_blueprint_id: string }
        Returns: string
      }
      create_archived_classroom_blueprint_atomic: {
        Args: {
          p_expected_source_revision: number
          p_operation_id: string
          p_plan: Json
          p_request_sha256: string
          p_source_classroom_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      create_assignment_ai_grading_run_atomic: {
        Args: {
          p_assignment_id: string
          p_gradable_count: number
          p_item_rows: Json
          p_model: string
          p_now?: string
          p_requested_student_ids: string[]
          p_selection_hash: string
          p_skipped_empty_count: number
          p_skipped_missing_count: number
          p_teacher_id: string
        }
        Returns: {
          assignment_id: string
          completed_at: string | null
          completed_count: number
          created_at: string
          error_samples_json: Json
          failed_count: number
          gradable_count: number
          gradex_last_polled_at: string | null
          gradex_run_id: string | null
          gradex_status: string | null
          gradex_submitted_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          model: string | null
          processed_count: number
          requested_count: number
          requested_student_ids_json: Json
          selection_hash: string
          skipped_empty_count: number
          skipped_missing_count: number
          started_at: string | null
          status: string
          triggered_by: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "assignment_ai_grading_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_assignment_doc_with_pal_event_atomic: {
        Args: {
          p_assignment_id: string
          p_pal_event: Json
          p_student_id: string
          p_viewed_at: string
        }
        Returns: Json
      }
      create_classroom_calendar_v1: {
        Args: {
          p_actor_id: string
          p_classroom_id: string
          p_dates: string[]
          p_end_date: string
          p_start_date: string
        }
        Returns: {
          classroom_id: string
          date: string
          id: string
          is_class_day: boolean
          prompt_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "class_days"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_classroom_enrollment_with_pal_event_atomic: {
        Args: {
          p_classroom_id: string
          p_pal_event: Json
          p_student_id: string
        }
        Returns: Json
      }
      create_course_blueprint_atomic: {
        Args: {
          p_expected_source_revision: number
          p_operation_id: string
          p_operation_type: string
          p_plan: Json
          p_request_sha256: string
          p_source_classroom_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      create_course_blueprint_atomic_v2: {
        Args: {
          p_expected_source_revision: number
          p_operation_id: string
          p_operation_type: string
          p_plan: Json
          p_request_sha256: string
          p_source_classroom_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      create_course_blueprint_atomic_v2_pre_managed_storage: {
        Args: {
          p_expected_source_revision: number
          p_operation_id: string
          p_operation_type: string
          p_plan: Json
          p_request_sha256: string
          p_source_classroom_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      create_course_blueprint_classroom_proposal_atomic: {
        Args: {
          p_blueprint_id: string
          p_blueprint_version_id: string
          p_diff: Json
          p_expected_blueprint_revision: number
          p_expected_classroom_revision: number
          p_idempotency_key: string
          p_operations: Json
          p_request_sha256: string
          p_target_classroom_id: string
          p_teacher_id: string
        }
        Returns: {
          applied_at: string | null
          applied_blueprint_revision: number | null
          applied_classroom_revision: number | null
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          course_blueprint_id: string
          created_at: string
          diff_json: Json
          id: string
          idempotency_key: string
          operations_json: Json
          payload_schema_version: number
          rejected_at: string | null
          request_sha256: string
          source_classroom_id: string | null
          source_kind: string
          status: string
          target_classroom_id: string | null
          target_kind: string
          teacher_id: string
          updated_at: string
          validation_errors: Json
        }
        SetofOptions: {
          from: "*"
          to: "course_blueprint_change_proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_course_blueprint_proposal_atomic: {
        Args: {
          p_base_blueprint_version_id: string
          p_base_classroom_revision: number
          p_blueprint_id: string
          p_diff: Json
          p_expected_blueprint_revision: number
          p_idempotency_key: string
          p_operations: Json
          p_request_sha256: string
          p_source_classroom_id: string
          p_source_kind: string
          p_teacher_id: string
        }
        Returns: {
          applied_at: string | null
          applied_blueprint_revision: number | null
          applied_classroom_revision: number | null
          base_blueprint_revision: number
          base_blueprint_version_id: string | null
          base_classroom_revision: number | null
          course_blueprint_id: string
          created_at: string
          diff_json: Json
          id: string
          idempotency_key: string
          operations_json: Json
          payload_schema_version: number
          rejected_at: string | null
          request_sha256: string
          source_classroom_id: string | null
          source_kind: string
          status: string
          target_classroom_id: string | null
          target_kind: string
          teacher_id: string
          updated_at: string
          validation_errors: Json
        }
        SetofOptions: {
          from: "*"
          to: "course_blueprint_change_proposals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_test_ai_grading_run_atomic: {
        Args: {
          p_eligible_student_count: number
          p_eligible_student_ids: string[]
          p_item_rows: Json
          p_model: string
          p_prompt_guideline_override?: string
          p_requested_student_ids: string[]
          p_selection_hash: string
          p_skipped_already_graded_count: number
          p_skipped_unanswered_count: number
          p_teacher_id: string
          p_test_id: string
          p_unanswered_rows: Json
        }
        Returns: Json
      }
      delete_assignment_submission_artifact_atomic: {
        Args: {
          p_assignment_id: string
          p_requirement_id: string
          p_student_id: string
        }
        Returns: Json
      }
      delete_student_test_attempt_atomic: {
        Args: { p_student_id: string; p_test_id: string }
        Returns: Json
      }
      delete_student_test_attempts_atomic: {
        Args: { p_student_ids: string[]; p_test_id: string }
        Returns: Json
      }
      delete_test_atomic: {
        Args: { p_teacher_id: string; p_test_id: string }
        Returns: Json
      }
      discard_pristine_assignment_draft_atomic: {
        Args: {
          p_assignment_id: string
          p_expected_updated_at: string
          p_teacher_id: string
        }
        Returns: Json
      }
      discard_pristine_test_draft_atomic: {
        Args: {
          p_expected_draft_version: number
          p_expected_test_updated_at: string
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      enqueue_assignment_artifact_storage_cleanup_path: {
        Args: { p_delay_seconds?: number; p_storage_path: string }
        Returns: boolean
      }
      enqueue_attendance_outbound_message_v1: {
        Args: { p_classroom_id: string; p_message: Json }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_attendance_outbound_message_v2: {
        Args: {
          p_at?: string
          p_classroom_id: string
          p_message: Json
          p_teacher_id: string
        }
        Returns: {
          attempts: number
          classroom_id: string
          created_at: string
          delivered_at: string | null
          entitlement_revision: number | null
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          message_type: string
          next_attempt_at: string
          payload: Json
          response_payload: Json | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_integration_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_pal_event: {
        Args: {
          p_event: Json
          p_source_id: string
          p_source_kind: string
          p_student_id: string
        }
        Returns: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          last_error_detail: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json
          source_id: string
          source_kind: string
          status: string
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pal_event_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_test_document_snapshot_storage_cleanup_path: {
        Args: { p_delay_seconds?: number; p_storage_path: string }
        Returns: boolean
      }
      ensure_blueprint_json_artifact_ids: {
        Args: { p_items: Json }
        Returns: Json
      }
      fail_assignment_artifact_storage_cleanup: {
        Args: { p_cleanup_id: string; p_error: string; p_lease_token: string }
        Returns: boolean
      }
      fail_attendance_outbox_v1: {
        Args: {
          p_error_code: string
          p_error_detail: string
          p_lease_token: string
          p_outbox_id: string
        }
        Returns: boolean
      }
      fail_classroom_archive_compaction: {
        Args: {
          p_error_code: string
          p_operation_id: string
          p_retryable: boolean
          p_teacher_id: string
        }
        Returns: boolean
      }
      fail_classroom_archive_export: {
        Args: {
          p_error_code: string
          p_operation_id: string
          p_retryable: boolean
          p_teacher_id: string
        }
        Returns: boolean
      }
      fail_classroom_archive_object_upload_cleanup: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      fail_classroom_archive_restore: {
        Args: {
          p_error_code: string
          p_operation_id: string
          p_retryable: boolean
          p_teacher_id: string
        }
        Returns: boolean
      }
      fail_classroom_archive_source_object_cleanup: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      fail_classroom_gradex_extract: {
        Args: {
          p_error_code: string
          p_operation_id: string
          p_retryable: boolean
          p_teacher_id: string
        }
        Returns: boolean
      }
      fail_classroom_gradex_extract_cleanup: {
        Args: {
          p_error_code: string
          p_extract_id: string
          p_lease_token: string
        }
        Returns: boolean
      }
      fail_classroom_purge_object: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_object_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      fail_course_blueprint_purge_object: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_object_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      fail_managed_storage_cleanup: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_object_id: string
        }
        Returns: boolean
      }
      fail_pal_event_outbox: {
        Args: {
          p_error_code: string
          p_error_detail: string
          p_lease_token: string
          p_outbox_id: string
        }
        Returns: boolean
      }
      fail_student_purge_object: {
        Args: {
          p_error_code: string
          p_lease_token: string
          p_object_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      fail_test_document_snapshot_storage_cleanup: {
        Args: { p_cleanup_id: string; p_error: string; p_lease_token: string }
        Returns: boolean
      }
      finalize_assignment_ai_grading_item_atomic: {
        Args: {
          p_ai_feedback_model: string
          p_ai_feedback_suggestion: string
          p_apply_teacher_feedback_draft: boolean
          p_attempt_count: number
          p_feedback: string
          p_graded_by: string
          p_item_id: string
          p_item_status: string
          p_mark_graded: boolean
          p_now: string
          p_score_completion: number
          p_score_thinking: number
          p_score_workflow: number
          p_skip_reason: string
          p_teacher_id: string
        }
        Returns: Json
      }
      finalize_assignment_ai_grading_item_with_provenance_atomic: {
        Args: {
          p_ai_feedback_model: string
          p_ai_feedback_suggestion: string
          p_ai_grading_provenance: Json
          p_apply_teacher_feedback_draft: boolean
          p_attempt_count: number
          p_feedback: string
          p_graded_by: string
          p_item_id: string
          p_item_status: string
          p_mark_graded: boolean
          p_now: string
          p_score_completion: number
          p_score_thinking: number
          p_score_workflow: number
          p_skip_reason: string
          p_teacher_id: string
        }
        Returns: Json
      }
      finalize_cold_archived_classroom_purge: {
        Args: { p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      finalize_course_blueprint_purge: {
        Args: { p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      finalize_hot_archived_classroom_purge: {
        Args: { p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      finalize_hot_archived_classroom_purge_v118: {
        Args: { p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      finalize_student_purge: {
        Args: { p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      finalize_student_purge_without_attendance_v1: {
        Args: { p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      finalize_test_ai_grading_item_atomic: {
        Args: {
          p_ai_grading_basis: string
          p_ai_model: string
          p_ai_reference_answers: Json
          p_attempt_count: number
          p_feedback: string
          p_item_id: string
          p_lease_token: string
          p_now: string
          p_score: number
          p_teacher_id: string
        }
        Returns: Json
      }
      finalize_test_ai_grading_item_with_provenance_atomic: {
        Args: {
          p_ai_grading_basis: string
          p_ai_grading_provenance: Json
          p_ai_model: string
          p_ai_reference_answers: Json
          p_attempt_count: number
          p_feedback: string
          p_item_id: string
          p_lease_token: string
          p_now: string
          p_score: number
          p_teacher_id: string
        }
        Returns: Json
      }
      finalize_test_attempts_for_grading_atomic: {
        Args: {
          p_closed_by: string
          p_student_ids: string[]
          p_test_id: string
        }
        Returns: Json
      }
      finish_cleanup_history_cron_run: {
        Args: {
          p_error_code: string
          p_http_status: number
          p_metrics?: Json
          p_run_id: string
          p_status: string
        }
        Returns: boolean
      }
      get_attendance_classroom_access_v1: {
        Args: { p_at?: string; p_classroom_id: string; p_teacher_id: string }
        Returns: Json
      }
      get_attendance_classroom_id_access_v1: {
        Args: { p_at?: string; p_classroom_id: string }
        Returns: Json
      }
      get_attendance_decommission: {
        Args: {
          p_classroom_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      get_attendance_entitlement_transition_health_v1: {
        Args: { p_classroom_id: string; p_teacher_id: string }
        Returns: Json
      }
      get_attendance_pilot_readiness_v1: {
        Args: { p_at: string; p_teacher_id: string }
        Returns: Json
      }
      get_classroom_archive_source_object_presence: {
        Args: { p_storage_bucket: string; p_storage_path: string }
        Returns: Json
      }
      get_cleanup_history_cron_health_snapshot: {
        Args: { p_scheduled_max_age_minutes?: number; p_stale_minutes?: number }
        Returns: Json
      }
      get_cold_archived_classroom_purge_inventory: {
        Args: {
          p_archive_id: string
          p_classroom_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      get_course_blueprint_purge_inventory: {
        Args: { p_blueprint_id: string; p_teacher_id: string }
        Returns: Json
      }
      get_hot_archived_classroom_purge_inventory: {
        Args: { p_classroom_id: string; p_teacher_id: string }
        Returns: Json
      }
      get_managed_deletion_deep_health_snapshot: { Args: never; Returns: Json }
      get_managed_deletion_health_snapshot: {
        Args: { p_stuck_after_seconds?: number }
        Returns: Json
      }
      get_managed_deletion_health_snapshot_v121: {
        Args: { p_stuck_after_seconds?: number }
        Returns: Json
      }
      get_managed_storage_object_presence: {
        Args: { p_storage_bucket: string; p_storage_path: string }
        Returns: Json
      }
      get_student_purge_health_snapshot: {
        Args: { p_failed_minutes?: number; p_stuck_minutes?: number }
        Returns: Json
      }
      get_student_purge_inventory: {
        Args: {
          p_classroom_id: string
          p_student_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      get_teacher_log_history_preview: {
        Args: {
          p_classroom_id: string
          p_limit?: number
          p_student_ids: string[]
        }
        Returns: {
          classroom_id: string
          created_at: string
          date: string
          id: string
          minutes_reported: number
          mood: string
          on_time: boolean
          rich_content: Json
          student_id: string
          text: string
          updated_at: string
          version: number
        }[]
      }
      guard_classroom_purge_lifecycle: {
        Args: { p_classroom_id: string }
        Returns: undefined
      }
      guard_course_blueprint_purge_lifecycle: {
        Args: { p_blueprint_id: string }
        Returns: undefined
      }
      heartbeat_managed_storage_blueprint_copy_owner: {
        Args: {
          p_created_by_user_id: string
          p_operation_id: string
          p_owner_id: string
          p_source_course_blueprint_id: string
        }
        Returns: boolean
      }
      instantiate_course_blueprint_atomic: {
        Args: {
          p_blueprint_id: string
          p_expected_content_revision: number
          p_operation_id: string
          p_plan: Json
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      instantiate_course_blueprint_atomic_v2: {
        Args: {
          p_blueprint_id: string
          p_blueprint_version_id: string
          p_expected_content_revision: number
          p_operation_id: string
          p_plan: Json
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      instantiate_course_blueprint_atomic_v2_pre_managed_storage: {
        Args: {
          p_blueprint_id: string
          p_blueprint_version_id: string
          p_expected_content_revision: number
          p_operation_id: string
          p_plan: Json
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      instantiate_course_blueprint_atomic_v2_pre_question_identity: {
        Args: {
          p_blueprint_id: string
          p_blueprint_version_id: string
          p_expected_content_revision: number
          p_operation_id: string
          p_plan: Json
          p_request_sha256: string
          p_teacher_id: string
        }
        Returns: Json
      }
      is_classroom_archive_maintenance_mode: {
        Args: { p_mode: string }
        Returns: boolean
      }
      is_valid_grading_review: { Args: { p_review: Json }; Returns: boolean }
      issue_auth_session: {
        Args: {
          p_auth_source: string
          p_expected_credential_version: number
          p_expires_at: string
          p_previous_token_hash: string
          p_token_hash: string
          p_user_id: string
          p_workos_user_id: string
        }
        Returns: boolean
      }
      list_attendance_reconciliation_targets_v1: {
        Args: { p_limit?: number; p_lookback_hours?: number; p_now: string }
        Returns: Json
      }
      list_attendance_reconciliation_targets_v2: {
        Args: {
          p_classroom_id: string
          p_limit?: number
          p_lookback_hours?: number
          p_now: string
          p_teacher_id: string
        }
        Returns: Json
      }
      list_attendance_reconciliation_targets_v3: {
        Args: { p_limit?: number; p_lookback_hours?: number; p_now: string }
        Returns: Json
      }
      list_attendance_sync_targets_v1: {
        Args: { p_limit?: number }
        Returns: Json
      }
      list_attendance_sync_targets_v2: {
        Args: { p_classroom_id: string; p_limit?: number; p_teacher_id: string }
        Returns: Json
      }
      list_attendance_sync_targets_v3: {
        Args: { p_at: string; p_limit?: number }
        Returns: Json
      }
      lock_managed_storage_protocol: { Args: never; Returns: boolean }
      managed_storage_blueprint_protocol_ready: {
        Args: never
        Returns: boolean
      }
      managed_storage_entity_sha256: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: string
      }
      managed_storage_exact_lock: {
        Args: { p_storage_bucket: string; p_storage_path: string }
        Returns: undefined
      }
      managed_storage_identity_sha256: {
        Args: { p_storage_bucket: string; p_storage_path: string }
        Returns: string
      }
      managed_storage_legacy_object_id: {
        Args: { p_storage_bucket: string; p_storage_path: string }
        Returns: string
      }
      managed_storage_mark_ready: {
        Args: { p_object_id: string }
        Returns: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "managed_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      managed_storage_object_is_referenced: {
        Args: { p_object_id: string }
        Returns: boolean
      }
      managed_storage_payload_has_exact_reference: {
        Args: {
          p_object_id: string
          p_payload: Json
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      managed_storage_payload_ids: {
        Args: { p_payload: Json }
        Returns: {
          managed_object_id: string
        }[]
      }
      managed_storage_payload_path_occurrences: {
        Args: { p_payload: Json; p_storage_path: string }
        Returns: number
      }
      managed_storage_payload_raw_references: {
        Args: { p_payload: Json }
        Returns: {
          managed_object_id: string
          storage_bucket: string
          storage_path: string
        }[]
      }
      managed_storage_public_url_identity: {
        Args: { p_value: string }
        Returns: {
          storage_bucket: string
          storage_path: string
        }[]
      }
      normalize_classroom_archive_restore_row: {
        Args: { p_operation_id: string; p_row: Json; p_table_name: string }
        Returns: Json
      }
      normalize_classroom_archive_restore_row_v143: {
        Args: { p_operation_id: string; p_row: Json; p_table_name: string }
        Returns: Json
      }
      normalize_classroom_archive_restore_row_v147: {
        Args: { p_operation_id: string; p_row: Json; p_table_name: string }
        Returns: Json
      }
      pause_managed_storage_enforcement: { Args: never; Returns: boolean }
      prepare_attendance_snapshot_v1: {
        Args: {
          p_classroom_id: string
          p_teacher_id: string
          p_window_end: string
          p_window_start: string
        }
        Returns: Json
      }
      prepare_attendance_snapshot_v2: {
        Args: {
          p_at?: string
          p_classroom_id: string
          p_teacher_id: string
          p_window_end: string
          p_window_start: string
        }
        Returns: Json
      }
      publish_test_from_draft_atomic: {
        Args: {
          p_expected_draft_version: number
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      queue_managed_storage_cleanup: {
        Args: { p_error_code?: string; p_object_id: string }
        Returns: boolean
      }
      reconcile_managed_storage_json_references: {
        Args: never
        Returns: number
      }
      reconcile_managed_storage_relational_references: {
        Args: never
        Returns: number
      }
      record_attendance_decommission_receipt: {
        Args: {
          p_classroom_id: string
          p_operation_id: string
          p_receipt: Json
          p_teacher_id: string
        }
        Returns: Json
      }
      record_pal_daily_log_week_configuration_atomic: {
        Args: {
          p_config_version: number
          p_configured_at: string
          p_eligible_days: number
          p_pal_event: Json
          p_period_key: string
          p_period_status: string
          p_student_id: string
        }
        Returns: Json
      }
      recover_managed_storage_blueprint_copy_owner: {
        Args: {
          p_confirm_no_live_worker: boolean
          p_created_by_user_id: string
          p_expected_expires_at: string
          p_operation_id: string
          p_owner_id: string
          p_source_course_blueprint_id: string
        }
        Returns: boolean
      }
      refresh_managed_storage_readiness: {
        Args: never
        Returns: {
          completed_at: string | null
          finding_count: number
          generation: number
          id: string
          inventory_digest: string | null
          object_count: number
          protocol_version: number
          reference_count: number
          started_at: string
          status: string
          writer_revision: number | null
        }
        SetofOptions: {
          from: "*"
          to: "managed_storage_readiness_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_legacy_managed_storage_object: {
        Args: {
          p_byte_size: number
          p_classroom_id: string
          p_content_sha256?: string
          p_content_type: string
          p_course_blueprint_id: string
          p_created_by_user_id: string
          p_data_subject_user_id: string
          p_object_id: string
          p_purpose: string
          p_resource_id: string
          p_resource_type: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "managed_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_course_guide_import_extraction_slot: {
        Args: { p_lease_token: string; p_teacher_id: string }
        Returns: boolean
      }
      remove_classroom_roster_entries_atomic: {
        Args: { p_classroom_id: string; p_roster_ids: string[] }
        Returns: Json
      }
      renew_classroom_archive_object_upload_cleanup_lease: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      renew_classroom_archive_source_object_cleanup_lease: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
        }
        Returns: boolean
      }
      renew_classroom_gradex_extract_cleanup_lease: {
        Args: {
          p_extract_id: string
          p_lease_seconds?: number
          p_lease_token: string
        }
        Returns: boolean
      }
      renew_test_ai_grading_run_lease: {
        Args: {
          p_lease_seconds?: number
          p_lease_token: string
          p_run_id: string
        }
        Returns: boolean
      }
      reorder_assignments_preserve_materials: {
        Args: { p_assignment_ids: Json; p_classroom_id: string }
        Returns: undefined
      }
      reorder_classwork_items: {
        Args: { p_classroom_id: string; p_items: Json }
        Returns: undefined
      }
      replace_assignment_submission_requirements_atomic: {
        Args: { p_assignment_id: string; p_requirements: Json }
        Returns: {
          artifact_id: string
          assignment_id: string
          created_at: string
          id: string
          instructions: string
          label: string
          position: number
          required: boolean
          source_artifact_id: string | null
          source_blueprint_version_id: string | null
          type: string
          updated_at: string
          validation_policy_json: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "assignment_submission_requirements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      replace_gradebook_categories: {
        Args: { p_categories: Json; p_classroom_id: string }
        Returns: {
          classroom_id: string
          created_at: string
          default_assessment_weight: number
          id: string
          is_default: boolean
          name: string
          percentage: number
          position: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "gradebook_categories"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      requeue_pal_event_outbox: {
        Args: { p_outbox_id: string }
        Returns: boolean
      }
      resolve_classroom_archive_resource_classroom_id: {
        Args: { p_row_id: string; p_table_name: string }
        Returns: string
      }
      resolve_classroom_archive_resource_classroom_id_versioned: {
        Args: {
          p_contract_version: number
          p_row_id: string
          p_table_name: string
        }
        Returns: string
      }
      resolve_managed_storage_blueprint_copy_source: {
        Args: {
          p_classroom_id: string
          p_course_blueprint_id: string
          p_managed_object_id?: string
          p_storage_path: string
          p_teacher_id: string
        }
        Returns: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "managed_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_attendance_outbox_v1: {
        Args: {
          p_error_code: string
          p_error_detail: string
          p_lease_token: string
          p_next_attempt_at: string
          p_outbox_id: string
        }
        Returns: boolean
      }
      retry_pal_event_outbox: {
        Args: {
          p_error_code: string
          p_error_detail: string
          p_lease_token: string
          p_next_attempt_at: string
          p_outbox_id: string
        }
        Returns: boolean
      }
      return_assignment_docs_atomic: {
        Args: {
          p_assignment_id: string
          p_now?: string
          p_student_ids: string[]
          p_teacher_id: string
        }
        Returns: {
          returned_count: number
          skipped_count: number
        }[]
      }
      return_assignment_docs_with_feedback_atomic: {
        Args: {
          p_assignment_id: string
          p_now: string
          p_student_ids: string[]
          p_teacher_id: string
        }
        Returns: Json
      }
      return_assignment_feedback_atomic: {
        Args: {
          p_assignment_id: string
          p_expected_doc_updated_at: string
          p_feedback: string
          p_now: string
          p_student_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      return_test_attempts_atomic: {
        Args: {
          p_returned_by: string
          p_student_ids: string[]
          p_submitted_at_by_student?: Json
          p_test_id: string
        }
        Returns: Json
      }
      save_assignment_ai_grade_atomic: {
        Args: {
          p_ai_feedback_model: string
          p_ai_feedback_suggestion: string
          p_apply_teacher_feedback_draft: boolean
          p_assignment_id: string
          p_expected_doc_updated_at: string
          p_feedback: string
          p_graded_by: string
          p_mark_graded: boolean
          p_now: string
          p_score_completion: number
          p_score_thinking: number
          p_score_workflow: number
          p_student_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      save_assignment_ai_grade_with_provenance_atomic: {
        Args: {
          p_ai_feedback_model: string
          p_ai_feedback_suggestion: string
          p_ai_grading_provenance: Json
          p_apply_teacher_feedback_draft: boolean
          p_assignment_id: string
          p_expected_doc_updated_at: string
          p_feedback: string
          p_graded_by: string
          p_mark_graded: boolean
          p_now: string
          p_score_completion: number
          p_score_thinking: number
          p_score_workflow: number
          p_student_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      save_assignment_ai_grades_atomic: {
        Args: {
          p_assignment_id: string
          p_grade_rows: Json
          p_now: string
          p_teacher_id: string
        }
        Returns: Json
      }
      save_assignment_doc_atomic: {
        Args: {
          p_assignment_id: string
          p_char_count: number
          p_content: Json
          p_expected_updated_at: string
          p_keystroke_count: number
          p_metric_session_id: string
          p_paste_word_count: number
          p_patch: Json
          p_save_sequence: number
          p_save_session_id: string
          p_snapshot: Json
          p_student_id: string
          p_trigger: string
          p_word_count: number
        }
        Returns: Json
      }
      save_assignment_grades_atomic: {
        Args: {
          p_apply_comments: boolean
          p_apply_grade: boolean
          p_assignment_id: string
          p_expected_doc_updated_at_by_student: Json
          p_feedback: string
          p_mark_graded: boolean
          p_now: string
          p_score_completion: number
          p_score_thinking: number
          p_score_workflow: number
          p_student_ids: string[]
          p_teacher_id: string
        }
        Returns: Json
      }
      save_course_blueprint_version_atomic: {
        Args: {
          p_blueprint_id: string
          p_expected_draft_revision: number
          p_snapshot: Json
          p_snapshot_schema_version: number
          p_snapshot_sha256: string
          p_source_kind: string
          p_source_metadata: Json
          p_teacher_id: string
        }
        Returns: {
          course_blueprint_id: string
          created_at: string
          created_by: string
          id: string
          snapshot_json: Json
          snapshot_schema_version: number
          snapshot_sha256: string
          source_draft_revision: number
          source_kind: string
          source_metadata: Json
          version_number: number
        }
        SetofOptions: {
          from: "*"
          to: "course_blueprint_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_test_attempt_atomic: {
        Args: { p_responses: Json; p_student_id: string; p_test_id: string }
        Returns: Json
      }
      save_test_draft_atomic: {
        Args: {
          p_content: Json
          p_documents: Json
          p_expected_documents: Json
          p_expected_draft_version: number
          p_teacher_id: string
          p_test_id: string
          p_update_documents: boolean
        }
        Returns: Json
      }
      save_test_response_grades_atomic: {
        Args: {
          p_grade_rows: Json
          p_now: string
          p_student_id: string
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      save_test_response_grades_with_provenance_atomic: {
        Args: {
          p_grade_rows: Json
          p_now: string
          p_student_id: string
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      save_test_unanswered_grades_atomic: {
        Args: {
          p_now: string
          p_rows: Json
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      seal_classroom_purge_inventory: {
        Args: {
          p_expected_object_count: number
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      set_attendance_teacher_entitlement_v1: {
        Args: {
          p_actor_ref: string
          p_expected_revision?: number
          p_operation_id: string
          p_reason_code: string
          p_source: string
          p_status: string
          p_teacher_id: string
          p_valid_from: string
          p_valid_until: string
        }
        Returns: Json
      }
      set_classroom_calendar_day_v1: {
        Args: {
          p_actor_id: string
          p_classroom_id: string
          p_date: string
          p_is_class_day: boolean
        }
        Returns: {
          classroom_id: string
          date: string
          id: string
          is_class_day: boolean
          prompt_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "class_days"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_pika_manual_attendance_marks: {
        Args: {
          p_class_date: string
          p_classroom_id: string
          p_status: string
          p_student_ids: string[]
          p_teacher_id: string
        }
        Returns: number
      }
      set_pika_manual_attendance_settings: {
        Args: {
          p_classroom_id: string
          p_expected_revision: number
          p_session_ends_local: string
          p_session_starts_local: string
          p_source_mode: string
          p_teacher_id: string
        }
        Returns: Json
      }
      set_test_ai_grading_item_state_atomic: {
        Args: {
          p_attempt_count: number
          p_completed_at: string
          p_item_id: string
          p_last_error_code: string
          p_last_error_message: string
          p_lease_token: string
          p_next_retry_at: string
          p_question_grading_snapshot: Json
          p_started_at: string
          p_status: string
        }
        Returns: boolean
      }
      settle_managed_storage_blueprint_copy_owner: {
        Args: {
          p_created_by_user_id: string
          p_operation_id: string
          p_outcome: string
          p_owner_id: string
          p_source_course_blueprint_id: string
        }
        Returns: boolean
      }
      stage_attendance_roster_snapshot_v1: {
        Args: {
          p_classroom_id: string
          p_message: Json
          p_source_token: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_attendance_roster_snapshot_v2: {
        Args: {
          p_at?: string
          p_classroom_id: string
          p_message: Json
          p_source_token: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_attendance_schedule_snapshot_v1: {
        Args: {
          p_classroom_id: string
          p_message: Json
          p_source_token: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_attendance_schedule_snapshot_v2: {
        Args: {
          p_at?: string
          p_classroom_id: string
          p_message: Json
          p_source_token: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_attendance_timing_schedule_v1: {
        Args: {
          p_at?: string
          p_classroom_id: string
          p_cutoffs: Json
          p_message: Json
          p_source_token: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_classroom_archive_compaction_objects: {
        Args: { p_objects: Json; p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      stage_classroom_archive_object_upload: {
        Args: {
          p_expected_byte_size: number
          p_expected_sha256: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      stage_classroom_archive_object_upload_v2: {
        Args: {
          p_archive_format_version: number
          p_expected_byte_size: number
          p_expected_sha256: string
          p_operation_id: string
          p_storage_bucket: string
          p_storage_path: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      stage_classroom_archive_restore_rows: {
        Args: {
          p_operation_id: string
          p_rows: Json
          p_table_name: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_classroom_archive_restore_rows_v2: {
        Args: {
          p_operation_id: string
          p_restore_contract_version: number
          p_rows: Json
          p_table_name: string
          p_teacher_id: string
        }
        Returns: Json
      }
      stage_classroom_purge_objects: {
        Args: { p_objects: Json; p_operation_id: string; p_teacher_id: string }
        Returns: Json
      }
      student_purge_conflict: {
        Args: { p_classroom_id: string; p_student_id: string }
        Returns: string
      }
      student_purge_inventory_resources: {
        Args: { p_classroom_id: string; p_student_id: string }
        Returns: {
          disposition: string
          row_id: string
          table_name: string
        }[]
      }
      student_purge_lock: {
        Args: { p_classroom_id: string; p_student_id: string }
        Returns: undefined
      }
      student_purge_rollout_allows: {
        Args: {
          p_classroom_id: string
          p_student_id: string
          p_teacher_id: string
        }
        Returns: boolean
      }
      submit_assignment_doc_atomic:
        | {
            Args: {
              p_assignment_id: string
              p_char_count: number
              p_content: Json
              p_expected_updated_at: string
              p_student_id: string
              p_word_count: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_acknowledged_missing_requirement_ids: string[]
              p_assignment_id: string
              p_char_count: number
              p_content: Json
              p_expected_updated_at: string
              p_student_id: string
              p_word_count: number
            }
            Returns: Json
          }
      submit_assignment_doc_with_pal_event_atomic:
        | {
            Args: {
              p_assignment_id: string
              p_char_count: number
              p_content: Json
              p_expected_updated_at: string
              p_pal_event: Json
              p_student_id: string
              p_word_count: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_acknowledged_missing_requirement_ids: string[]
              p_assignment_id: string
              p_char_count: number
              p_content: Json
              p_expected_updated_at: string
              p_pal_event: Json
              p_student_id: string
              p_word_count: number
            }
            Returns: Json
          }
      submit_test_attempt_atomic: {
        Args: {
          p_responses: Json
          p_student_id: string
          p_submitted_at?: string
          p_test_id: string
        }
        Returns: Json
      }
      supersede_attendance_outbox_epoch_v1: {
        Args: {
          p_actor_ref: string
          p_expected_entitlement_revision: number
          p_operation_id: string
          p_outbox_ids: string[]
          p_reason_code: string
          p_teacher_id: string
        }
        Returns: Json
      }
      sync_test_document_snapshot_atomic: {
        Args: {
          p_document_id: string
          p_expected_url: string
          p_snapshot_content_type: string
          p_snapshot_path: string
          p_synced_at: string
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      sync_test_document_snapshot_managed_atomic: {
        Args: {
          p_document_id: string
          p_expected_url: string
          p_managed_object_id: string
          p_snapshot_content_type: string
          p_snapshot_path: string
          p_synced_at: string
          p_teacher_id: string
          p_test_id: string
        }
        Returns: Json
      }
      test_document_snapshot_path_is_referenced: {
        Args: { p_storage_path: string }
        Returns: boolean
      }
      tick_attendance_decommission: {
        Args: {
          p_classroom_id: string
          p_operation_id: string
          p_teacher_id: string
        }
        Returns: Json
      }
      unsubmit_assignment_doc_atomic: {
        Args: { p_assignment_id: string; p_student_id: string }
        Returns: Json
      }
      unsubmit_test_attempts_atomic: {
        Args: {
          p_student_ids: string[]
          p_test_id: string
          p_updated_by: string
        }
        Returns: Json
      }
      update_assignment_with_submission_requirements_atomic: {
        Args: { p_assignment_id: string; p_requirements: Json; p_updates: Json }
        Returns: Json
      }
      update_test_documents_atomic: {
        Args: {
          p_documents: Json
          p_expected_documents: Json
          p_expected_status: string
          p_show_results: boolean
          p_status: string
          p_teacher_id: string
          p_test_id: string
          p_title: string
          p_update_show_results: boolean
          p_update_status: boolean
          p_update_title: boolean
        }
        Returns: Json
      }
      update_test_student_access_atomic: {
        Args: {
          p_state: string
          p_student_ids: string[]
          p_test_id: string
          p_updated_by: string
        }
        Returns: Json
      }
      upsert_attendance_timing_policy_v1: {
        Args: {
          p_absent_minutes_before_end: number
          p_at?: string
          p_classroom_id: string
          p_enabled: boolean
          p_entry_closes_minutes_before_end: number
          p_entry_opens_minutes_before: number
          p_expected_revision?: number
          p_present_grace_minutes: number
          p_session_end_day_offset: number
          p_session_ends_local: string
          p_session_starts_local: string
          p_teacher_id: string
        }
        Returns: Json
      }
      upsert_attendance_window_policy_v1: {
        Args: {
          p_classroom_id: string
          p_close_day_offset: number
          p_closes_local: string
          p_enabled: boolean
          p_expected_revision?: number
          p_opens_local: string
          p_teacher_id: string
        }
        Returns: Json
      }
      upsert_attendance_window_policy_v2: {
        Args: {
          p_at?: string
          p_classroom_id: string
          p_close_day_offset: number
          p_closes_local: string
          p_enabled: boolean
          p_expected_revision?: number
          p_opens_local: string
          p_teacher_id: string
        }
        Returns: Json
      }
      upsert_developer_feedback_candidate: {
        Args: {
          p_affected_area: string
          p_confidence: number
          p_dedupe_key: string
          p_implementation_hint: string
          p_model: string
          p_original_request: string
          p_refined_request: string
          p_source_classroom_id: string
          p_source_date: string
          p_source_entry_count: number
          p_suggested_agent: string
          p_title: string
        }
        Returns: Json
      }
      upsert_student_entry_with_pal_event_atomic: {
        Args: {
          p_classroom_id: string
          p_date: string
          p_expected_version?: number
          p_minutes_reported?: number
          p_mood?: string
          p_on_time: boolean
          p_pal_event: Json
          p_rich_content: Json
          p_student_id: string
          p_text: string
        }
        Returns: Json
      }
      verify_and_reserve_classroom_archive_source_objects: {
        Args: { p_limit: number; p_operation_id: string }
        Returns: Json
      }
      verify_managed_storage_upload: {
        Args: { p_content_sha256?: string; p_object_id: string }
        Returns: {
          attempt_count: number
          byte_size: number | null
          classroom_id: string | null
          cleanup_reason_code: string | null
          content_sha256: string | null
          content_type: string | null
          course_blueprint_id: string | null
          created_at: string
          created_by_user_id: string | null
          data_subject_user_id: string | null
          deleted_at: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          provisional_owner_id: string | null
          purpose: string
          ready_at: string | null
          reservation_expires_at: string | null
          resource_id: string | null
          resource_type: string | null
          status: string
          storage_bucket: string
          storage_path: string
          updated_at: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "managed_storage_objects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
