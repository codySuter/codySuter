import logging

from .bot import run
from .config import load_settings


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx logs every polling request at INFO; that's just noise.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    run(load_settings())


if __name__ == "__main__":
    main()
