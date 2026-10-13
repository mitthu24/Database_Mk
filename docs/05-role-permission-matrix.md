# Role & Permission Matrix

| Capability | Founder | Company Admin | Employee (default) | Employee (granted) |
|---|---|---|---|---|
| Manage companies (create/activate/suspend) | ✅ | ❌ | ❌ | ❌ |
| Manage plans & trials | ✅ | ❌ | ❌ | ❌ |
| Approve manual payments | ✅ | ❌ | ❌ | ❌ |
| View platform-wide audit log | ✅ | ❌ (company-scoped only) | ❌ | ❌ |
| Edit own company profile | ❌ | ✅ | ❌ | ❌ |
| Create/deactivate employees | ❌ | ✅ | ❌ | ❌ |
| Assign table-level permissions | ❌ | ✅ | ❌ | ❌ |
| Create a logical table | ❌ | ✅ | ❌ | ❌ |
| Edit table name/columns | ❌ | ✅ | ❌ | ❌ |
| Delete a table | ❌ | ✅ | ❌ | ❌ |
| Clear all rows in a table | ❌ | ✅ | ❌ | ❌ |
| Import (append) | ❌ | ✅ | ❌ | ✅ if `can_import` |
| Import (replace all) | ❌ | ✅ | ❌ | ❌ (admin-only; destructive+structural) |
| View table data | ❌ | ✅ (all company tables) | ❌ | ✅ if `can_view` |
| Edit rows | ❌ | ✅ | ❌ | ✅ if `can_edit` |
| Export data | ❌ | ✅ | ❌ | ✅ if `can_export` |
| View import history / audit log (company) | ❌ | ✅ | ❌ | ❌ |
| Change own password | ✅ | ✅ | ✅ | ✅ |

Notes:
- "Employee (default)" = an employee with no `data_permissions` rows for a
  given table: they see nothing for that table, not even its existence in
  navigation.
- Replace-all is intentionally admin-only everywhere: it is both destructive
  and structural (it can change row count/shape), unlike append.
- Founder never gets *implicit* access to perform company-admin actions
  inside a company (e.g. they don't edit a company's table data) — their
  surface is platform management, not acting as that company's admin.
