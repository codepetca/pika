'use client'

import { createPortal } from 'react-dom'
import type { RefObject } from 'react'
import { MoreVertical, Settings } from 'lucide-react'
import { TeacherWorkSurfaceIconMenuButton, type TeacherWorkSurfaceActionItem } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import { QrCode } from '@/ui'

export function AttendancePoster({ title, url, attendanceHours, qrRef, posterActions }: {
  title: string
  url: string
  attendanceHours: string | null
  qrRef: RefObject<HTMLDivElement>
  posterActions: TeacherWorkSurfaceActionItem[]
}) {
  const poster = url ? (
    <div
      data-classroom-qr-print-layout
      className="flex h-full w-full flex-col items-center bg-qr-background p-12 text-center text-qr-foreground"
    >
      <div className="shrink-0">
        <p data-classroom-qr-print-heading className="text-5xl font-semibold leading-tight">{title}</p>
      </div>
      <div className="mt-8 flex min-h-0 w-full flex-1 items-center justify-center">
        <QrCode
          value={url}
          label={`${title} check in for attendance QR code`}
          className="aspect-square h-full max-h-full max-w-full border-0 bg-qr-background p-[10%]"
          codeClassName="h-full max-w-none"
        />
      </div>
      <div className="mt-8 shrink-0">
        {attendanceHours ? <p data-classroom-qr-print-hours className="text-4xl font-semibold">{attendanceHours}</p> : null}
        <p data-classroom-qr-print-subtitle className="mt-3 text-2xl font-medium">Check in for attendance</p>
      </div>
    </div>
  ) : null

  return <>
          <div className="flex h-full min-h-0 flex-col items-stretch justify-center gap-3 sm:flex-row sm:gap-6">
            <div className="flex w-full min-w-0 shrink-0 flex-col items-center justify-center px-3 text-center sm:w-1/3">
              <p className="text-3xl font-semibold leading-tight text-text-default sm:text-5xl">{title}</p>
              <p className="mt-4 hidden text-xl font-medium leading-tight text-text-default sm:mt-6 sm:block sm:text-3xl">
                Check in for attendance
              </p>
              {attendanceHours ? (
                <p className="mt-2 hidden text-lg font-medium text-text-muted sm:mt-3 sm:block sm:text-2xl">{attendanceHours}</p>
              ) : null}
              <div className="mt-8 hidden sm:block">
                <TeacherWorkSurfaceIconMenuButton
                  ariaLabel="Poster settings"
                  tooltip="Poster settings"
                  icon={<Settings className="h-5 w-5" aria-hidden="true" />}
                  items={posterActions}
                  menuAriaLabel="Poster settings"
                  menuAlign="center"
                  variant="secondary"
                  className="h-11 w-11"
                />
              </div>
            </div>
            <div ref={qrRef} className="flex min-h-0 flex-none items-center justify-center sm:h-full sm:flex-1">
              <QrCode
                value={url}
                label={`${title} check in for attendance QR code`}
                className="aspect-square w-full max-w-64 border-0 bg-qr-background p-[10%] sm:h-full sm:w-auto sm:max-w-full"
                codeClassName="h-full max-w-none"
              />
            </div>
            <div className="absolute left-3 top-3 sm:hidden">
              <TeacherWorkSurfaceIconMenuButton
                ariaLabel="QR options"
                tooltip="QR options"
                icon={<MoreVertical className="h-5 w-5" aria-hidden="true" />}
                items={posterActions}
                menuAlign="start"
                className="h-11 w-11"
              />
            </div>
          </div>
    {poster && typeof document !== 'undefined' ? createPortal(
      <div data-classroom-qr-print className="hidden h-screen w-screen">
        <style media="print">{'@page { size: portrait; margin: 0; }'}</style>
        {poster}
      </div>, document.body) : null}
  </>
}
