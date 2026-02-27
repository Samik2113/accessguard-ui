
import React from 'react';
import { Shield, FileCheck, BarChart3, History, Layers, UserCheck } from 'lucide-react';
import { UserRole } from './types';

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5" />, roles: [UserRole.ADMIN, UserRole.AUDITOR] },
  { id: 'my-access', label: 'My Access', icon: <UserCheck className="w-5 h-5" />, roles: [UserRole.USER] },
  { id: 'inventory', label: 'Inventory', icon: <Shield className="w-5 h-5" />, roles: [UserRole.ADMIN] },
  { id: 'reviews', label: 'My Reviews', icon: <FileCheck className="w-5 h-5" />, roles: [UserRole.USER] },
  { id: 'governance', label: 'Governance', icon: <BarChart3 className="w-5 h-5" />, roles: [UserRole.ADMIN, UserRole.AUDITOR] },
  { id: 'audit', label: 'Audit Logs', icon: <History className="w-5 h-5" />, roles: [UserRole.ADMIN, UserRole.AUDITOR] },
];


export const HR_TEMPLATE_HEADERS = [
  'userId',      // ← make this explicit
  'name',
  'email',
  'department',
  'managerId',
  'title',
  'status'
];

export const APP_ACCESS_TEMPLATE_HEADERS = ['id', 'userId', 'userName', 'email', 'entitlement'];
export const ENTITLEMENT_TEMPLATE_HEADERS = ['entitlement', 'description', 'owner', 'isPrivileged', 'risk', 'riskScore'];
export const SOD_POLICY_TEMPLATE_HEADERS = ['policyName', 'appId1', 'entitlement1', 'appId2', 'entitlement2', 'riskLevel'];

export const SAMPLE_USERS = [];
export const SAMPLE_ACCESS = [];
