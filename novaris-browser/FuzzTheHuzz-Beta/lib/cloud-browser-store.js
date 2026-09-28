// Cloud Browser is independent of the legacy /cloud remote-PC integration.
export function createCloudBrowserStore(db) {
  return {
    async allowed(userId) {
      if (!userId) return false;
      const { data, error } = await db.from("cloud_gaming_permissions").select("enabled").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data?.enabled === true;
    },
    async list() {
      const permissions = {};
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db
          .from("cloud_gaming_permissions")
          .select("user_id, enabled")
          .order("user_id")
          .range(offset, offset + 999);
        if (error) throw error;
        for (const row of data || []) permissions[row.user_id] = row.enabled === true;
        if (!data || data.length < 1000) return permissions;
      }
    },
    async set(userId, enabled, actorId) {
      const { data: profile, error: profileError } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return false;
      const { error } = await db.from("cloud_gaming_permissions").upsert(
        {
          user_id: userId,
          enabled,
          updated_by: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      return true;
    },
  };
}
