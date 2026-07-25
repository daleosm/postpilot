from app.security import hash_session_token, verify_node_scrypt_password

NODE_SCRYPT_FIXTURE = (
    "scrypt$MTIzNDU2Nzg5MDEyMzQ1Ng$"
    "aAaoFKa_-aot6WEqHm6oO7AZvYJHqPscdsdUE1nRiHPThNQlYBvG55ReLW2LDAXnYeX0S9GXCOSojyY3ZfC_Tw"
)


def test_verifies_existing_node_scrypt_hashes() -> None:
    assert verify_node_scrypt_password("password", NODE_SCRYPT_FIXTURE)
    assert not verify_node_scrypt_password("incorrect", NODE_SCRYPT_FIXTURE)


def test_session_token_hash_is_stable_and_not_the_raw_token() -> None:
    assert hash_session_token("session-token") == hash_session_token("session-token")
    assert hash_session_token("session-token") != "session-token"
    assert hash_session_token("session-token", "service-secret") != hash_session_token("session-token", "other-secret")
