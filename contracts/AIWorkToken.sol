// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AIWorkToken ($AIWK)
 * @notice Platform utility token for the AIWork ecosystem.
 *         Used for staking, governance, and platform fees.
 *         Actual task payments use stablecoins (USDC) — this token
 *         captures platform value and aligns incentives.
 */
contract AIWorkToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18; // 1B tokens
    uint256 public totalMinted;

    // Fee distribution (basis points out of 10000)
    uint256 public constant PLATFORM_FEE_BPS = 250; // 2.5%
    uint256 public constant VALIDATOR_FEE_BPS = 100; // 1.0%
    uint256 public constant BURN_BPS = 50; // 0.5%

    address public treasury;
    address public validatorPool;

    // ─── Events ────────────────────────────────────────────────────
    event FeeDistributed(
        address indexed from,
        uint256 platformFee,
        uint256 validatorFee,
        uint256 burned
    );
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ValidatorPoolUpdated(address indexed oldPool, address indexed newPool);

    // ─── Errors ────────────────────────────────────────────────────
    error ExceedsMaxSupply(uint256 requested, uint256 remaining);
    error ZeroAddress();

    constructor(
        address _treasury,
        address _validatorPool
    ) ERC20("AIWork Token", "AIWK") {
        if (_treasury == address(0) || _validatorPool == address(0))
            revert ZeroAddress();

        treasury = _treasury;
        validatorPool = _validatorPool;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PLATFORM_ROLE, msg.sender);
    }

    /**
     * @notice Mint new tokens (capped at MAX_SUPPLY)
     */
    function mint(
        address to,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) {
        if (totalMinted + amount > MAX_SUPPLY)
            revert ExceedsMaxSupply(amount, MAX_SUPPLY - totalMinted);

        totalMinted += amount;
        _mint(to, amount);
    }

    /**
     * @notice Distribute fees from a payment amount.
     *         Caller must hold the tokens being distributed.
     *         Splits: 2.5% platform, 1% validators, 0.5% burn
     */
    function distributeFees(
        uint256 amount
    ) external onlyRole(PLATFORM_ROLE) returns (uint256 platformFee, uint256 validatorFee, uint256 burnAmount) {
        platformFee = (amount * PLATFORM_FEE_BPS) / 10000;
        validatorFee = (amount * VALIDATOR_FEE_BPS) / 10000;
        burnAmount = (amount * BURN_BPS) / 10000;

        _transfer(msg.sender, treasury, platformFee);
        _transfer(msg.sender, validatorPool, validatorFee);
        _burn(msg.sender, burnAmount);

        emit FeeDistributed(msg.sender, platformFee, validatorFee, burnAmount);
    }

    /**
     * @notice Update treasury address
     */
    function setTreasury(
        address _treasury
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_treasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    /**
     * @notice Update validator pool address
     */
    function setValidatorPool(
        address _validatorPool
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_validatorPool == address(0)) revert ZeroAddress();
        emit ValidatorPoolUpdated(validatorPool, _validatorPool);
        validatorPool = _validatorPool;
    }
}
