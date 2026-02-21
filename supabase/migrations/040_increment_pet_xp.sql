-- Migration: Add atomic XP increment function
-- Prevents lost-update race conditions when concurrent requests grant XP

create or replace function public.increment_pet_xp(p_pet_id uuid, p_amount integer)
returns integer
language sql
as $$
  update public.user_pets
  set xp = xp + p_amount
  where id = p_pet_id
  returning xp;
$$;
