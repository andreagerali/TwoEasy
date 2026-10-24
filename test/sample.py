import os

def greet(name: str) -> str:
    """Say hello."""
    return f"Hello, {name}!"

if __name__ == "__main__":
    print(greet(os.getenv("USER", "world")))
