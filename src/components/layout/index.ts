// 3-Panel Layout System
// See /src/lib/layout-config.ts for configuration options

export {
  LayoutInitialStateProvider,
  useLayoutInitialState,
} from './LayoutInitialStateProvider'

export {
  ThreePanelProvider,
  useThreePanel,
  useLeftSidebar,
  useRightSidebar,
  useMobileDrawer,
  type ThreePanelProviderProps,
} from './ThreePanelProvider'

export { ThreePanelShell, type ThreePanelShellProps } from './ThreePanelShell'

export { LeftSidebar, type LeftSidebarProps } from './LeftSidebar'

export { RightSidebar, RightSidebarToggle, type RightSidebarProps } from './RightSidebar'

export { MainContent, type MainContentProps } from './MainContent'

export { NavItems, type NavItemsProps, type ClassroomNavItemId } from './NavItems'
