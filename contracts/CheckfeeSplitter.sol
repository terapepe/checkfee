// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * checkfee – chia phí creator Pons v2: 90% creator / 10% checkfee.
 *
 * - Một Splitter cho mỗi ví creator (payout wallet), deploy bằng CREATE2 qua
 *   CheckfeeSplitterFactory nên địa chỉ tính trước được. Khi launch token trên Pons,
 *   địa chỉ Splitter được dùng làm creatorFeeRecipient.
 * - Không có hàm nào gọi transferCreatorFeeRecipient → ví nhận phí của token
 *   bị khoá vĩnh viễn vào Splitter; creator & treasury là immutable.
 * - harvest(token) ai gọi cũng được: Splitter tự sweep phí trên Pons (vì nó là
 *   creatorFeeRecipient), claim từ escrow rồi chia 90/10. Tiền chỉ có thể đi tới
 *   creator và treasury.
 */

interface IPonsFactory {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }
    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

interface IPonsCurve {
    function sweepFees(uint256 minBuybackTokensOut) external;
}

interface IPonsHook {
    function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut) external;
}

interface IPonsEscrow {
    function balanceOf(address recipient) external view returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
    function claim() external;
    function claimToken(address token) external;
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

contract CheckfeeSplitter {
    uint256 public constant TREASURY_BPS = 1000; // 10%
    uint256 private constant BPS = 10_000;

    address public immutable creator;
    address public immutable treasury;
    IPonsFactory public immutable ponsFactory;
    IPonsHook public immutable ponsHook;
    IPonsEscrow public immutable ponsEscrow;

    // Khoản chuyển ETH thất bại (người nhận từ chối) được giữ lại để tự rút
    mapping(address => mapping(address => uint256)) public owed; // asset => account => amount
    mapping(address => uint256) public totalOwed;                // asset => amount

    uint256 private _lock = 1;

    event Swept(address indexed token, uint8 phase, bool ok);
    event Distributed(address indexed asset, uint256 toCreator, uint256 toTreasury);
    event Owed(address indexed asset, address indexed account, uint256 amount);
    event Withdrawn(address indexed asset, address indexed account, uint256 amount);

    error NotOurToken();
    error ZeroAddress();
    error Reentrancy();
    error TransferFailed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address creator_, address treasury_, address factory_, address hook_, address escrow_) {
        if (creator_ == address(0) || treasury_ == address(0) || factory_ == address(0) || hook_ == address(0) || escrow_ == address(0)) {
            revert ZeroAddress();
        }
        creator = creator_;
        treasury = treasury_;
        ponsFactory = IPonsFactory(factory_);
        ponsHook = IPonsHook(hook_);
        ponsEscrow = IPonsEscrow(escrow_);
    }

    receive() external payable {}

    /// Sweep phí của token trên Pons, claim từ escrow và chia 90/10.
    /// Gom luôn: quote asset của token (ETH hoặc pair token) và chính launch token (buyback vest).
    function harvest(address token) external nonReentrant {
        IPonsFactory.LaunchedToken memory L = ponsFactory.getLaunchedToken(token);
        if (!L.exists || L.creatorFeeRecipient != address(this)) revert NotOurToken();
        _sweep(L);
        _claimAndSplit(L.pairToken);
        _claimAndSplit(token);
    }

    /// Claim + chia một asset bất kỳ đã nằm trong escrow / contract (address(0) = ETH), không sweep.
    function distribute(address asset) external nonReentrant {
        _claimAndSplit(asset);
    }

    /// Rút khoản bị giữ lại do chuyển thất bại trước đó.
    function withdraw(address asset) external nonReentrant {
        uint256 amt = owed[asset][msg.sender];
        if (amt == 0) return;
        owed[asset][msg.sender] = 0;
        totalOwed[asset] -= amt;
        if (asset == address(0)) {
            (bool ok,) = msg.sender.call{value: amt}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!_erc20Transfer(asset, msg.sender, amt)) revert TransferFailed();
        }
        emit Withdrawn(asset, msg.sender, amt);
    }

    /// Phí chưa sweep / chưa claim (để hiển thị).
    function pendingInEscrow(address asset) external view returns (uint256) {
        return asset == address(0) ? ponsEscrow.balanceOf(address(this)) : ponsEscrow.balanceOfToken(address(this), asset);
    }

    // ---------------------------------------------------------------- internal

    function _sweep(IPonsFactory.LaunchedToken memory L) private {
        bool ok;
        if (L.phase == 0) {
            try IPonsCurve(L.curve).sweepFees(0) { ok = true; } catch {}
        } else if (L.phase == 2) {
            (address c0, address c1) = L.pairToken < L.token ? (L.pairToken, L.token) : (L.token, L.pairToken);
            bytes32 poolId = keccak256(abi.encode(c0, c1, L.poolFee, L.tickSpacing, address(ponsHook)));
            try ponsHook.sweepPoolFees(poolId, 0, 0) { ok = true; } catch {}
        }
        // sweep có thể bị từ chối (vd. cần operator khi phải swap nội bộ) → vẫn claim phần đã có trong escrow
        emit Swept(L.token, L.phase, ok);
    }

    function _claimAndSplit(address asset) private {
        uint256 bal;
        if (asset == address(0)) {
            if (ponsEscrow.balanceOf(address(this)) > 0) ponsEscrow.claim();
            bal = address(this).balance - totalOwed[asset];
        } else {
            if (ponsEscrow.balanceOfToken(address(this), asset) > 0) ponsEscrow.claimToken(asset);
            bal = IERC20(asset).balanceOf(address(this)) - totalOwed[asset];
        }
        if (bal == 0) return;
        uint256 toTreasury = (bal * TREASURY_BPS) / BPS;
        uint256 toCreator = bal - toTreasury;
        _pay(asset, treasury, toTreasury);
        _pay(asset, creator, toCreator);
        emit Distributed(asset, toCreator, toTreasury);
    }

    function _pay(address asset, address to, uint256 amt) private {
        if (amt == 0) return;
        bool ok;
        if (asset == address(0)) {
            (ok,) = to.call{value: amt}("");
        } else {
            ok = _erc20Transfer(asset, to, amt);
        }
        if (!ok) {
            owed[asset][to] += amt;
            totalOwed[asset] += amt;
            emit Owed(asset, to, amt);
        }
    }

    function _erc20Transfer(address asset, address to, uint256 amt) private returns (bool) {
        (bool ok, bytes memory ret) = asset.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amt));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }
}

contract CheckfeeSplitterFactory {
    address public immutable treasury;
    address public immutable ponsFactory;
    address public immutable ponsHook;
    address public immutable ponsEscrow;

    event SplitterDeployed(address indexed creator, address indexed splitter, bytes32 salt);

    constructor(address treasury_, address factory_, address hook_, address escrow_) {
        treasury = treasury_;
        ponsFactory = factory_;
        ponsHook = hook_;
        ponsEscrow = escrow_;
    }

    function _initCode(address creator) private view returns (bytes memory) {
        return abi.encodePacked(
            type(CheckfeeSplitter).creationCode,
            abi.encode(creator, treasury, ponsFactory, ponsHook, ponsEscrow)
        );
    }

    /// Địa chỉ Splitter của creator (dùng làm creatorFeeRecipient khi launch), kể cả khi chưa deploy.
    function predict(address creator, bytes32 salt) public view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(_initCode(creator))));
        return address(uint160(uint256(h)));
    }

    /// Deploy Splitter (nếu chưa có). Ai gọi cũng được – creator/treasury cố định theo tham số.
    function deploy(address creator, bytes32 salt) public returns (address s) {
        s = predict(creator, salt);
        if (s.code.length > 0) return s;
        bytes memory code = _initCode(creator);
        assembly {
            s := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(s != address(0), "deploy failed");
        emit SplitterDeployed(creator, s, salt);
    }

    /// Deploy (nếu cần) rồi harvest token trong 1 giao dịch.
    function deployAndHarvest(address creator, bytes32 salt, address token) external returns (address s) {
        s = deploy(creator, salt);
        CheckfeeSplitter(payable(s)).harvest(token);
    }
}
