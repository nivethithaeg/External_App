-- Playing areas no longer need admin approval. Anything that was waiting is simply approved.
UPDATE playing_areas SET approval_status = 'approved', approval_note = NULL WHERE approval_status <> 'approved';
